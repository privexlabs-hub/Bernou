/**
 * Audience-window camera: re-acquires the SAME camera (by opaque deviceId)
 * that the presenter chose. Video only — never audio — so the meeting app
 * gets the microphone through its own mic selection and nothing echoes.
 *
 * This file imports nothing from the presenter app.
 */
import { attachStreamToVideo, videoFrameSource, type FrameSource } from "@bernou/composition-engine";

export interface AudienceCamera {
  source: FrameSource | null;
  deviceId: string | null;
  /**
   * Switch to a device (or null to release). Resolves when frames are flowing or it failed.
   * A device that failed isn't retried until another device (or null) is asked for.
   */
  use(deviceId: string | null): Promise<void>;
  /** Stop everything now, including a start still in flight. */
  release(): void;
  /** Human-readable last failure, for the presenter (sent back over the channel in a later step). */
  lastError: string | null;
}

const CAPTURE = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

/**
 * Chromium can give one camera a different deviceId in each window, so the
 * presenter's id may mean nothing here. With only one camera there is nothing
 * to confuse it with. With several, fail rather than put the wrong one on air.
 */
async function openCamera(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, ...CAPTURE }, audio: false });
  } catch (e) {
    if ((e as Error)?.name !== "OverconstrainedError") throw e;
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    if (cameras.length !== 1) throw e;
    return navigator.mediaDevices.getUserMedia({ video: CAPTURE, audio: false });
  }
}

export function createAudienceCamera(onSourceChange: (source: FrameSource | null) => void): AudienceCamera {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let inFlight: Promise<void> | null = null;
  let failedFor: string | null = null;
  // getUserMedia can't be aborted: every change bumps this, and a start that
  // resolves to find it changed stops its own stream.
  let generation = 0;

  const stopVideo = (v: HTMLVideoElement | null) => {
    if (!v) return;
    v.pause();
    v.srcObject = null;
  };
  const stopStream = (m: MediaStream | null) => {
    for (const t of m?.getTracks() ?? []) t.stop();
  };
  const teardown = () => {
    stopStream(stream);
    stopVideo(video);
    stream = null;
    video = null;
    if (cam.source) {
      cam.source = null;
      onSourceChange(null);
    }
  };

  const acquire = async (deviceId: string, op: number) => {
    let acquired: MediaStream | null = null;
    try {
      acquired = await openCamera(deviceId);
      if (op !== generation) return stopStream(acquired);
      const attached = await attachStreamToVideo(acquired);
      if (op !== generation) {
        stopVideo(attached);
        return stopStream(acquired);
      }
      const live = acquired;
      stream = live;
      video = attached;
      cam.source = videoFrameSource(attached);
      cam.lastError = null;
      onSourceChange(cam.source);
      live.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (stream !== live) return;
        teardown();
        failedFor = deviceId;
        cam.lastError = "ended";
      });
    } catch (e) {
      stopStream(acquired);
      if (op !== generation) return;
      cam.lastError = (e as Error)?.name ?? "CameraError";
      failedFor = deviceId;
    } finally {
      if (op === generation) inFlight = null;
    }
  };

  const cam: AudienceCamera = {
    source: null,
    deviceId: null,
    lastError: null,
    use(deviceId) {
      if (deviceId === cam.deviceId) {
        if (inFlight) return inFlight;
        if (deviceId === null || cam.source || failedFor === deviceId) return Promise.resolve();
      }
      const op = ++generation;
      inFlight = null;
      failedFor = null;
      teardown();
      cam.deviceId = deviceId;
      if (!deviceId) return Promise.resolve();
      inFlight = acquire(deviceId, op);
      return inFlight;
    },
    release() {
      generation++;
      inFlight = null;
      failedFor = null;
      cam.deviceId = null;
      teardown();
    },
  };
  return cam;
}

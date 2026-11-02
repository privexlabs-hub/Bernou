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
  /** Switch to a device (or null to release). Resolves when frames are flowing or it failed. */
  use(deviceId: string | null): Promise<void>;
  release(): void;
  /** Human-readable last failure, for the presenter (sent back over the channel in a later step). */
  lastError: string | null;
}

export function createAudienceCamera(): AudienceCamera {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let pending: Promise<void> | null = null;

  const cam: AudienceCamera = {
    source: null,
    deviceId: null,
    lastError: null,
    async use(deviceId) {
      if (deviceId === cam.deviceId && (deviceId === null || cam.source)) return;
      if (pending) await pending;
      pending = (async () => {
        cam.release();
        cam.deviceId = deviceId;
        if (!deviceId) return;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            audio: false,
          });
          video = await attachStreamToVideo(stream);
          cam.source = videoFrameSource(video);
          cam.lastError = null;
          stream.getVideoTracks()[0]?.addEventListener("ended", () => {
            if (cam.deviceId === deviceId) cam.release();
          });
        } catch (e) {
          cam.lastError = (e as Error)?.name ?? "CameraError";
          cam.source = null;
        }
      })();
      await pending;
      pending = null;
    },
    release() {
      for (const t of stream?.getTracks() ?? []) t.stop();
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      stream = null;
      video = null;
      cam.source = null;
    },
  };
  return cam;
}

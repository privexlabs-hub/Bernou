/**
 * PRIVATE store: cameras, microphones, live streams, permission state, errors,
 * and the audio graph. Device LABELS live here and never cross the boundary.
 *
 * The only thing that leaves this store towards the audience is the selected
 * camera deviceId (an opaque id), via compositionStore.setCameraDeviceId, so
 * the audience window can open the same camera.
 */
import { create } from "zustand";
import {
  activeDeviceId,
  createAudioGraph,
  listDevices,
  mapMediaError,
  onDeviceChange,
  openCamera,
  openMicrophone,
  queryPermission,
  stopStream,
  streamIsLive,
  type AudioGraph,
  type MediaDevice,
  type MediaErrorInfo,
  type PermissionState,
} from "@bernou/media-core";
import { useCompositionStore } from "@/stores/public/compositionStore";

export interface ReleaseReport {
  /** Live tracks that were ended. */
  tracksStopped: number;
  /** Device starts still in flight, which will stop themselves when they resolve. */
  requestsCancelled: number;
}

interface DevicesState {
  cameras: MediaDevice[];
  microphones: MediaDevice[];
  cameraPermission: PermissionState;
  micPermission: PermissionState;

  selectedCameraId: string | null;
  selectedMicId: string | null;

  cameraStream: MediaStream | null;
  cameraError: MediaErrorInfo | null;
  cameraBusy: boolean;

  micStream: MediaStream | null;
  micError: MediaErrorInfo | null;
  micBusy: boolean;
  micMuted: boolean;
  audioGraph: AudioGraph | null;

  refreshDevices: () => Promise<void>;
  startCamera: (deviceId?: string | null) => Promise<void>;
  stopCamera: () => void;
  startMic: (deviceId?: string | null) => Promise<void>;
  /** The graph a recording can rely on even with the mic off: MediaRecorder can't take a track added later. */
  ensureAudioGraph: () => Promise<AudioGraph>;
  stopMic: () => void;
  setMicMuted: (m: boolean) => void;
  /** Stop everything and release all hardware. */
  releaseAll: () => Promise<ReleaseReport>;
  _listen: () => () => void;
}

/**
 * getUserMedia can't be aborted, so each start takes a generation number and
 * re-checks it after every await. Anything that ends capture bumps the number,
 * which makes a start still in flight stop its own stream when it resolves.
 */
let cameraOp = 0;
let micOp = 0;

export const useDevicesStore = create<DevicesState>((set, get) => ({
  cameras: [],
  microphones: [],
  cameraPermission: "unknown",
  micPermission: "unknown",
  selectedCameraId: null,
  selectedMicId: null,
  cameraStream: null,
  cameraError: null,
  cameraBusy: false,
  micStream: null,
  micError: null,
  micBusy: false,
  micMuted: false,
  audioGraph: null,

  async refreshDevices() {
    const [devices, cameraPermission, micPermission] = await Promise.all([listDevices(), queryPermission("camera"), queryPermission("microphone")]);
    const cameras = devices.filter((d) => d.kind === "videoinput");
    const microphones = devices.filter((d) => d.kind === "audioinput");
    const s = get();
    // If the selected device vanished, fall back to the first (and the UI shows it).
    const selectedCameraId = s.selectedCameraId && cameras.some((c) => c.deviceId === s.selectedCameraId) ? s.selectedCameraId : (cameras[0]?.deviceId ?? null);
    const selectedMicId = s.selectedMicId && microphones.some((m) => m.deviceId === s.selectedMicId) ? s.selectedMicId : (microphones[0]?.deviceId ?? null);
    set({ cameras, microphones, cameraPermission, micPermission, selectedCameraId, selectedMicId });
  },

  async startCamera(deviceId) {
    const s = get();
    if (s.cameraBusy) return;
    const op = ++cameraOp;
    set({ cameraBusy: true, cameraError: null });
    stopStream(s.cameraStream);
    let stream: MediaStream | null = null;
    try {
      stream = await openCamera({ deviceId: deviceId ?? s.selectedCameraId });
      if (op !== cameraOp) return stopStream(stream);
      const live = stream;
      const actual = activeDeviceId(live, "video");
      // Camera unplugged mid-session → reflect it.
      live.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (get().cameraStream === live) get().stopCamera();
      });
      set({ cameraStream: live, selectedCameraId: actual ?? deviceId ?? s.selectedCameraId, cameraBusy: false });
      useCompositionStore.getState().setCameraDeviceId(actual);
      useCompositionStore.getState().patchCamera({ enabled: true });
    } catch (e) {
      stopStream(stream);
      if (op !== cameraOp) return;
      set({ cameraStream: null, cameraError: mapMediaError(e, "camera"), cameraBusy: false });
      useCompositionStore.getState().patchCamera({ enabled: false });
      useCompositionStore.getState().setCameraDeviceId(null);
      return;
    }
    // Labels become available after the first grant. Failing to list them must not end a live camera.
    await get().refreshDevices().catch(() => undefined);
  },

  stopCamera() {
    cameraOp++;
    stopStream(get().cameraStream);
    set({ cameraStream: null, cameraBusy: false });
    useCompositionStore.getState().patchCamera({ enabled: false });
    useCompositionStore.getState().setCameraDeviceId(null);
  },

  async startMic(deviceId) {
    const s = get();
    if (s.micBusy) return;
    const op = ++micOp;
    set({ micBusy: true, micError: null });
    stopStream(s.micStream);
    let stream: MediaStream | null = null;
    try {
      stream = await openMicrophone({ deviceId: deviceId ?? s.selectedMicId });
      if (op !== micOp) return stopStream(stream);
      const live = stream;
      const graph = await get().ensureAudioGraph();
      if (op !== micOp) return stopStream(live);
      graph.setSource(live);
      graph.setMuted(get().micMuted);
      live.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (get().micStream === live) get().stopMic();
      });
      set({ micStream: live, selectedMicId: activeDeviceId(live, "audio") ?? deviceId ?? s.selectedMicId, micBusy: false });
    } catch (e) {
      stopStream(stream);
      if (op !== micOp) return;
      set({ micStream: null, micError: mapMediaError(e, "microphone"), micBusy: false });
      return;
    }
    await get().refreshDevices().catch(() => undefined);
  },

  async ensureAudioGraph() {
    // Read here rather than earlier: one seen before an await may have been
    // closed since. Created synchronously, so concurrent callers share it.
    const graph = get().audioGraph ?? createAudioGraph();
    set({ audioGraph: graph });
    graph.setMuted(get().micMuted);
    await graph.resume();
    return graph;
  },

  stopMic() {
    micOp++;
    const s = get();
    stopStream(s.micStream);
    s.audioGraph?.setSource(null);
    set({ micStream: null, micBusy: false });
  },

  setMicMuted(m) {
    get().audioGraph?.setMuted(m);
    set({ micMuted: m });
  },

  async releaseAll() {
    const s = get();
    // Invalidate in-flight starts first, then end everything in this tick:
    // nothing below an await may be needed for capture to actually stop.
    cameraOp++;
    micOp++;
    const requestsCancelled = (s.cameraBusy ? 1 : 0) + (s.micBusy ? 1 : 0);
    const tracksStopped = [s.cameraStream, s.micStream].flatMap((m) => m?.getTracks() ?? []).filter((t) => t.readyState === "live").length;
    stopStream(s.cameraStream);
    stopStream(s.micStream);
    set({ cameraStream: null, micStream: null, audioGraph: null, cameraBusy: false, micBusy: false });
    useCompositionStore.getState().patchCamera({ enabled: false });
    useCompositionStore.getState().setCameraDeviceId(null);
    await s.audioGraph?.close();
    return { tracksStopped, requestsCancelled };
  },

  _listen() {
    return onDeviceChange(() => void get().refreshDevices());
  },
}));

export const selectCameraLive = (s: DevicesState) => streamIsLive(s.cameraStream);
export const selectMicLive = (s: DevicesState) => streamIsLive(s.micStream);

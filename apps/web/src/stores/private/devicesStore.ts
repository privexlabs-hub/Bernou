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
  stopMic: () => void;
  setMicMuted: (m: boolean) => void;
  /** Stop everything and release all hardware. */
  releaseAll: () => Promise<void>;
  _listen: () => () => void;
}

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
    set({ cameraBusy: true, cameraError: null });
    stopStream(s.cameraStream);
    try {
      const stream = await openCamera({ deviceId: deviceId ?? s.selectedCameraId });
      const actual = activeDeviceId(stream, "video");
      set({ cameraStream: stream, selectedCameraId: actual ?? deviceId ?? s.selectedCameraId, cameraBusy: false });
      useCompositionStore.getState().setCameraDeviceId(actual);
      useCompositionStore.getState().patchCamera({ enabled: true });
      // Labels become available after the first grant.
      await get().refreshDevices();
      // Camera unplugged mid-session → reflect it.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (get().cameraStream === stream) get().stopCamera();
      });
    } catch (e) {
      set({ cameraStream: null, cameraError: mapMediaError(e, "camera"), cameraBusy: false });
      useCompositionStore.getState().patchCamera({ enabled: false });
      useCompositionStore.getState().setCameraDeviceId(null);
    }
  },

  stopCamera() {
    stopStream(get().cameraStream);
    set({ cameraStream: null });
    useCompositionStore.getState().patchCamera({ enabled: false });
    useCompositionStore.getState().setCameraDeviceId(null);
  },

  async startMic(deviceId) {
    const s = get();
    if (s.micBusy) return;
    set({ micBusy: true, micError: null });
    stopStream(s.micStream);
    try {
      const stream = await openMicrophone({ deviceId: deviceId ?? s.selectedMicId });
      const graph = s.audioGraph ?? createAudioGraph();
      await graph.resume();
      graph.setSource(stream);
      graph.setMuted(s.micMuted);
      set({ micStream: stream, audioGraph: graph, selectedMicId: activeDeviceId(stream, "audio") ?? deviceId ?? s.selectedMicId, micBusy: false });
      await get().refreshDevices();
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (get().micStream === stream) get().stopMic();
      });
    } catch (e) {
      set({ micStream: null, micError: mapMediaError(e, "microphone"), micBusy: false });
    }
  },

  stopMic() {
    const s = get();
    stopStream(s.micStream);
    s.audioGraph?.setSource(null);
    set({ micStream: null });
  },

  setMicMuted(m) {
    get().audioGraph?.setMuted(m);
    set({ micMuted: m });
  },

  async releaseAll() {
    const s = get();
    stopStream(s.cameraStream);
    stopStream(s.micStream);
    await s.audioGraph?.close();
    set({ cameraStream: null, micStream: null, audioGraph: null, cameraBusy: false, micBusy: false });
    useCompositionStore.getState().patchCamera({ enabled: false });
    useCompositionStore.getState().setCameraDeviceId(null);
  },

  _listen() {
    return onDeviceChange(() => void get().refreshDevices());
  },
}));

export const selectCameraLive = (s: DevicesState) => streamIsLive(s.cameraStream);
export const selectMicLive = (s: DevicesState) => streamIsLive(s.micStream);

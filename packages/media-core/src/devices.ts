/**
 * Camera / microphone device management.
 *
 * Browser facts this module is built around:
 *  - enumerateDevices() returns empty labels (and may hide devices) until a
 *    permission for that kind has been granted. So: request → re-enumerate.
 *  - getUserMedia errors are typed by `name`; we map them to user guidance.
 *  - 'devicechange' fires on plug/unplug; a selected deviceId can vanish.
 *  - Every acquired track must be stopped explicitly or the camera light stays on.
 */

export type DeviceKind = "videoinput" | "audioinput";

export interface MediaDevice {
  deviceId: string;
  /** PRESENTER-ONLY. Labels never cross into the audience payload. */
  label: string;
  kind: DeviceKind;
}

export type PermissionState = "unknown" | "prompt" | "granted" | "denied" | "unavailable";

export interface MediaErrorInfo {
  code: "denied" | "not-found" | "in-use" | "overconstrained" | "insecure-context" | "unsupported" | "unknown";
  /** Short, user-facing explanation and what to do. */
  message: string;
  raw?: string | undefined;
}

export function isMediaDevicesSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}

export function mapMediaError(e: unknown, kind: "camera" | "microphone"): MediaErrorInfo {
  const name = (e as { name?: string })?.name ?? "";
  const raw = (e as { message?: string })?.message;
  const base = { raw } as const;
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return { code: "insecure-context", message: `The ${kind} is only available on https:// or localhost.`, ...base };
  }
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return { code: "denied", message: `${cap(kind)} access was blocked. Allow it in the browser's site permissions (the icon next to the address bar), then try again.`, ...base };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { code: "not-found", message: `No ${kind} was found. Connect one and try again.`, ...base };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { code: "in-use", message: `The ${kind} could not be started. Another app (Zoom, Teams, OBS…) may be using it, or the driver failed. Close other apps that use the ${kind} and try again.`, ...base };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { code: "overconstrained", message: `The selected ${kind} does not support the requested settings. Choose another device.`, ...base };
    case "TypeError":
      return { code: "unsupported", message: `This browser does not support ${kind} capture here.`, ...base };
    default:
      return { code: "unknown", message: `The ${kind} could not be started${raw ? ` (${raw})` : ""}.`, ...base };
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function listDevices(): Promise<MediaDevice[]> {
  if (!isMediaDevicesSupported()) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d): d is MediaDeviceInfo & { kind: DeviceKind } => d.kind === "videoinput" || d.kind === "audioinput")
    .map((d, i) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label || defaultLabel(d.kind, i) }));
}

function defaultLabel(kind: DeviceKind, i: number) {
  return `${kind === "videoinput" ? "Camera" : "Microphone"} ${i + 1}`;
}

/** Best-effort permission query. Not all browsers support Permissions API for camera/microphone. */
export async function queryPermission(name: "camera" | "microphone"): Promise<PermissionState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const st = await navigator.permissions.query({ name: name as PermissionName });
    return st.state as PermissionState;
  } catch {
    return "unknown";
  }
}

export function onDeviceChange(cb: () => void): () => void {
  if (!isMediaDevicesSupported()) return () => undefined;
  navigator.mediaDevices.addEventListener("devicechange", cb);
  return () => navigator.mediaDevices.removeEventListener("devicechange", cb);
}

export interface CameraRequest {
  deviceId?: string | null;
  width?: number;
  height?: number;
  frameRate?: number;
}

export async function openCamera(req: CameraRequest = {}): Promise<MediaStream> {
  if (!isMediaDevicesSupported()) throw Object.assign(new Error("MediaDevices unsupported"), { name: "TypeError" });
  const video: MediaTrackConstraints = {
    width: { ideal: req.width ?? 1280 },
    height: { ideal: req.height ?? 720 },
    frameRate: { ideal: req.frameRate ?? 30 },
  };
  if (req.deviceId) video.deviceId = { exact: req.deviceId };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export interface MicRequest {
  deviceId?: string | null;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export async function openMicrophone(req: MicRequest = {}): Promise<MediaStream> {
  if (!isMediaDevicesSupported()) throw Object.assign(new Error("MediaDevices unsupported"), { name: "TypeError" });
  const audio: MediaTrackConstraints = {
    echoCancellation: req.echoCancellation ?? true,
    noiseSuppression: req.noiseSuppression ?? true,
    autoGainControl: req.autoGainControl ?? true,
  };
  if (req.deviceId) audio.deviceId = { exact: req.deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

/** Stop every track and detach. Safe to call repeatedly. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  }
}

export function streamIsLive(stream: MediaStream | null | undefined): boolean {
  return !!stream && stream.getTracks().some((t) => t.readyState === "live");
}

/** The deviceId a live stream is actually using (may differ from the request on fallback). */
export function activeDeviceId(stream: MediaStream | null | undefined, kind: "video" | "audio"): string | null {
  const t = kind === "video" ? stream?.getVideoTracks()[0] : stream?.getAudioTracks()[0];
  return t?.getSettings().deviceId ?? null;
}

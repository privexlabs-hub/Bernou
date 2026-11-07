/** Messages between the editor page and its export Worker. */
import type { EditProject } from "@/db/dexie";

/**
 * OPFS folders. An export that becomes a recording goes where recordings live;
 * a WAV for download or a join preview is temporary, kept apart so the app's
 * clean-up of stray recording files never sees it.
 */
export const RECORDINGS_DIR = "recordings";
export const TEMP_DIR = "editor-temp";
export type OutputDir = typeof RECORDINGS_DIR | typeof TEMP_DIR;

export async function outputDir(name: OutputDir): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
}

export interface SourceInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sampleRate: number;
  channels: number;
  /** What an export will produce in this browser. */
  output: { container: "mp4" | "webm"; video: string; audio: string | null; hardware: "prefer-hardware" | "no-preference" } | null;
  /** Why noise removal can't be used, if it can't. */
  denoiseUnavailable: string | null;
}

export type ToWorker =
  | { type: "probe"; id: number; file: Blob }
  /** Decoded audio, downmixed to mono, for the preview and the waveform. */
  | { type: "decodeAudio"; id: number; file: Blob; peaksPerSecond: number }
  | { type: "export"; id: number; file: Blob; project: EditProject; fileName: string; dir: OutputDir; audioOnly: boolean; range?: { from: number; to: number } }
  | { type: "cancel" };

export type FromWorker =
  | { type: "probe"; id: number; info: SourceInfo }
  | { type: "decodeAudio"; id: number; samples: Float32Array; sampleRate: number; peaks: Float32Array }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "export"; id: number; result: ExportResult }
  | { type: "error"; id: number; message: string };

export interface ExportResult {
  fileName: string;
  bytes: number;
  durationMs: number;
  mime: string;
  extension: string;
  width: number;
  height: number;
  cancelled: boolean;
}

/** Messages between the editor page and its export Worker. */
import type { EditProject } from "@/db/dexie";
import type { MixTrack } from "../mixTracks";

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
  | { type: "export"; id: number; file: Blob; project: EditProject; fileName: string; dir: OutputDir; audioOnly: boolean; range?: { from: number; to: number }; audio: ExportAudio }
  /** Video thumbnails from `from` seconds on, a batch at a time. */
  | { type: "thumbnails"; id: number; file: Blob; from: number }
  /** Cancels one job; others carry on. */
  | { type: "cancel"; id: number };

export type FromWorker =
  | { type: "probe"; id: number; info: SourceInfo }
  | { type: "decodeAudio"; id: number; samples: Float32Array; sampleRate: number; peaks: Float32Array }
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "thumbs"; id: number; times: number[]; bitmaps: ImageBitmap[] }
  /** The end of a thumbnails job: `cancelled` if an export took the decoder, so the page can ask again from `next`. */
  | { type: "thumbnails"; id: number; cancelled: boolean; next: number }
  | { type: "export"; id: number; result: ExportResult }
  | { type: "error"; id: number; message: string };

/** The sound to make, decided on the page so the preview and export agree. */
export interface ExportAudio {
  /** Sample rate and channels of the mix: the recording's rate, else 48 kHz. */
  rate: number;
  channels: number;
  /** Added tracks, decoded at `rate` (copies: the page keeps its own for the preview). */
  tracks: (Omit<MixTrack, "planes"> & { planes: Float32Array[] })[];
  /** The music dip, 100 values a second over the whole output, or null if nothing dips. */
  envelope: Float32Array | null;
}

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

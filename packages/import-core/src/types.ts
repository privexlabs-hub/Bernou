/**
 * Output of every importer: rasterised slides only. No text layers, no
 * notes, no metadata beyond dimensions. This is deliberate — the audience
 * renderer only ever sees bitmaps.
 */
export interface RasterSlide {
  index: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  blob: Blob;
  thumb: Blob;
  thumbWidth: number;
  thumbHeight: number;
}

export interface ImportProgress {
  /** 0..1 */
  fraction: number;
  /** Human-readable, presenter-only. */
  stage: string;
  current: number;
  total: number;
}

export interface ImportOptions {
  /** Longest edge of the full-resolution render. Default 1920. */
  maxEdge?: number;
  /** Longest edge of the thumbnail. Default 240. */
  thumbEdge?: number;
  /** Encode full-res as JPEG at this quality to save space; PNG if undefined. */
  jpegQuality?: number;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
}

export interface ImportResult {
  slides: RasterSlide[];
  kind: "pdf" | "images";
  /** Non-fatal warnings to show the presenter (e.g. a notes-pages PDF). */
  warnings: string[];
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: "unsupported" | "corrupt" | "password" | "empty" | "aborted" | "too-large",
  ) {
    super(message);
    this.name = "ImportError";
  }
}

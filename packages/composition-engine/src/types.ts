import type { AudiencePayload } from "@bernou/audience-protocol";

/** Minimal 2D context surface the engine draws with (HTMLCanvas, Offscreen, or node-canvas in tests). */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type DrawableCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * Something the engine can draw: a decoded slide, a logo, or a live camera.
 * For live video, `source` is a <video> element and the engine reads its
 * intrinsic size each frame.
 */
export interface FrameSource {
  /** Current drawable, or null if not ready (camera warming up). */
  current(): CanvasImageSource | null;
  width(): number;
  height(): number;
}

/** Resolves asset ids (slides, logos) to decoded images. */
export interface AssetResolver {
  get(assetId: string): CanvasImageSource | null;
}

export interface EngineInputs {
  payload: AudiencePayload | null;
  assets: AssetResolver;
  /** Live camera source, or null. Only drawn when payload.camera.enabled. */
  camera: FrameSource | null;
}

export interface EngineOptions {
  /** Called after every rendered frame (tests, FPS meter). */
  onFrame?: (ts: number) => void;
}

// NOTE: there is deliberately no "presenter chrome" option. Drag handles and
// outlines are drawn by the presenter UI on a separate DOM layer above the
// preview canvas, so the engine renders byte-identical pixels for the preview,
// the recorder and the audience window.

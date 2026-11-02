/**
 * Audience Composition Engine.
 *
 * One function — renderFrame — turns (payload, assets, camera) into pixels.
 * createEngine wraps it with a scheduler and a canvas. The SAME renderFrame
 * powers the presenter preview, the recorder and the audience window.
 *
 * Invariants:
 *   - Input is exclusively an AudiencePayload plus named frame sources.
 *   - No text is ever drawn except payload.branding.title.
 *   - No state is kept between frames other than the last inputs.
 *   - Byte-identical output for identical inputs (given identical camera frames).
 */
import type { AudiencePayload } from "@bernou/audience-protocol";
import { drawBrandingLayer } from "./layers/brandingLayer";
import { drawCameraLayer } from "./layers/cameraLayer";
import { drawSlideLayer } from "./layers/slideLayer";
import { createScheduler, type Scheduler } from "./scheduler";
import type { AssetResolver, Ctx2D, DrawableCanvas, EngineInputs, EngineOptions, FrameSource } from "./types";

export const NEUTRAL_BACKGROUND = "#0b0d12";

/** Render one frame synchronously into ctx. Resizes nothing; caller sizes the canvas. */
export function renderFrame(ctx: Ctx2D, inputs: EngineInputs): void {
  const p = inputs.payload;
  const W = (ctx.canvas as { width: number }).width;
  const H = (ctx.canvas as { height: number }).height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = p?.output.background ?? NEUTRAL_BACKGROUND;
  ctx.fillRect(0, 0, W, H);
  if (!p) return;

  // The payload declares its own output size; scale if the canvas differs
  // (preview canvases are smaller than the output).
  const sx = W / p.output.width;
  const sy = H / p.output.height;
  if (sx !== 1 || sy !== 1) ctx.setTransform(sx, 0, 0, sy, 0, 0);

  drawSlideLayer(ctx, p, inputs.assets);
  drawCameraLayer(ctx, p, inputs.camera);
  drawBrandingLayer(ctx, p, inputs.assets);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export interface Engine {
  /** Replace the payload. Takes effect on the next frame. */
  setPayload(p: AudiencePayload | null): void;
  setCamera(c: FrameSource | null): void;
  setAssets(a: AssetResolver): void;
  /** Force a synchronous render now (e.g. after a payload change in tests). */
  renderNow(): void;
  start(): void;
  stop(): void;
  /** Resize the backing canvas. For the audience window and recorder this is the output size. */
  resize(width: number, height: number): void;
  readonly canvas: DrawableCanvas;
  inputs(): EngineInputs;
  scheduler(): Scheduler;
  /** Frames rendered since start (diagnostics / tests). */
  frameCount(): number;
}

export function createEngine(canvas: DrawableCanvas, initial: Partial<EngineInputs> = {}, opts: EngineOptions = {}, targetFps = 30): Engine {
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("composition-engine: 2D context unavailable");
  const state: EngineInputs = {
    payload: initial.payload ?? null,
    assets: initial.assets ?? { get: () => null },
    camera: initial.camera ?? null,
  };
  let frames = 0;
  let dirty = true;
  const sched = createScheduler(targetFps);

  const render = (ts: number) => {
    // Always redraw while a camera is enabled (live frames); otherwise only when dirty.
    const live = !!(state.payload?.camera.enabled && state.camera);
    if (!dirty && !live) return;
    renderFrame(ctx, state);
    frames++;
    dirty = false;
    opts.onFrame?.(ts);
  };

  return {
    canvas,
    setPayload(p) {
      state.payload = p;
      dirty = true;
    },
    setCamera(c) {
      state.camera = c;
      dirty = true;
    },
    setAssets(a) {
      state.assets = a;
      dirty = true;
    },
    renderNow() {
      dirty = true;
      render(typeof performance !== "undefined" ? performance.now() : Date.now());
    },
    start() {
      sched.start(render);
    },
    stop() {
      sched.stop();
    },
    resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        dirty = true;
      }
    },
    inputs: () => state,
    scheduler: () => sched,
    frameCount: () => frames,
  };
}

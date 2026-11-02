/**
 * Pure geometry for the composition. All functions are deterministic and
 * unit-tested; the renderer only turns these rects into draw calls.
 */
import type { AudiencePayload, CameraSpec } from "@bernou/audience-protocol";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Letterbox/pillarbox `src` inside `dst`, centred. */
export function fitContain(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const s = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Cover-fit: scale `src` to fill `dst`, cropping; returns the source crop rect. */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const dstAspect = dstW / dstH;
  const srcAspect = srcW / srcH;
  if (srcAspect > dstAspect) {
    const w = srcH * dstAspect;
    return { x: (srcW - w) / 2, y: 0, w, h: srcH };
  }
  const h = srcW / dstAspect;
  return { x: 0, y: (srcH - h) / 2, w: srcW, h };
}

/** Pixel rect of the camera overlay for a given output size. */
export function cameraRect(camera: CameraSpec, outputW: number, outputH: number): Rect {
  const w = camera.size * outputW;
  const h = camera.shape === "circle" ? w : w / camera.aspect;
  return { x: camera.x * outputW, y: camera.y * outputH, w, h };
}

/** The slide area for a layout. */
export function slideRect(payload: AudiencePayload): Rect {
  const { width, height } = payload.output;
  return { x: 0, y: 0, w: width, h: height };
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

export function pointInCamera(px: number, py: number, camera: CameraSpec, outputW: number, outputH: number): boolean {
  const r = cameraRect(camera, outputW, outputH);
  if (camera.shape === "circle") {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rad = r.w / 2;
    return (px - cx) ** 2 + (py - cy) ** 2 <= rad * rad;
  }
  return pointInRect(px, py, r);
}

/** Resize-handle hit test: bottom-right corner, within `handle` px. */
export function pointOnResizeHandle(px: number, py: number, camera: CameraSpec, outputW: number, outputH: number, handle: number): boolean {
  const r = cameraRect(camera, outputW, outputH);
  const hx = r.x + r.w;
  const hy = r.y + r.h;
  return Math.abs(px - hx) <= handle && Math.abs(py - hy) <= handle;
}

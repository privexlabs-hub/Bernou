/**
 * Canvas helpers shared by importers. Browser-only (uses OffscreenCanvas
 * where available, falls back to a detached <canvas>).
 */

export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

export async function canvasToBlob(canvas: AnyCanvas, mime: "image/png" | "image/jpeg" | "image/webp", quality?: number): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob(quality !== undefined ? { type: mime, quality } : { type: mime });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), mime, quality);
  });
}

/** Draw `source` scaled into a new canvas and encode it. */
export async function downscaleToBlob(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxEdge: number,
  mime: "image/png" | "image/jpeg" | "image/webp",
  quality?: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitWithin(srcW, srcH, maxEdge);
  const c = makeCanvas(width, height);
  const ctx = c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // JPEG has no alpha; paint white underneath so transparent PDFs don't go black.
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await canvasToBlob(c, mime, quality);
  return { blob, width, height };
}

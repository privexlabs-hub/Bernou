/**
 * Image importer: PNG / JPEG / WebP → one slide per image, in the order given.
 */
import { downscaleToBlob } from "../raster";
import { ImportError, type ImportOptions, type ImportResult, type RasterSlide } from "../types";

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function importImages(files: ReadonlyArray<File | Blob>, opts: ImportOptions = {}): Promise<ImportResult> {
  const maxEdge = opts.maxEdge ?? 1920;
  const thumbEdge = opts.thumbEdge ?? 240;
  const list = files.filter((f) => ACCEPTED.has(f.type));
  if (list.length === 0) throw new ImportError("No supported images (PNG, JPEG, WebP) were selected.", "unsupported");

  const slides: RasterSlide[] = [];
  for (let i = 0; i < list.length; i++) {
    if (opts.signal?.aborted) throw new ImportError("Import cancelled.", "aborted");
    opts.onProgress?.({ fraction: i / list.length, stage: `Decoding image ${i + 1} of ${list.length}`, current: i + 1, total: list.length });
    const f = list[i]!;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(f);
    } catch {
      throw new ImportError(`Could not decode ${"name" in f ? (f as File).name : "an image"}.`, "corrupt");
    }
    try {
      const needsScale = Math.max(bmp.width, bmp.height) > maxEdge;
      const mime: RasterSlide["mime"] = f.type === "image/png" ? "image/png" : "image/jpeg";
      const full = needsScale ? await downscaleToBlob(bmp, bmp.width, bmp.height, maxEdge, mime, 0.92) : { blob: f, width: bmp.width, height: bmp.height };
      const thumb = await downscaleToBlob(bmp, bmp.width, bmp.height, thumbEdge, "image/jpeg", 0.8);
      slides.push({ index: i, width: full.width, height: full.height, mime, blob: full.blob, thumb: thumb.blob, thumbWidth: thumb.width, thumbHeight: thumb.height });
    } finally {
      bmp.close();
    }
  }
  opts.onProgress?.({ fraction: 1, stage: "Done", current: list.length, total: list.length });
  return { slides, kind: "images", warnings: [] };
}

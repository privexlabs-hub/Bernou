/**
 * PDF importer built on PDF.js (pdfjs-dist 4.x).
 *
 * Each page is rendered ONCE at full output resolution, then the result is
 * downscaled for the thumbnail. Only the rasterised pixels leave this module:
 * no text content, no annotations, no document metadata.
 *
 * Privacy note (P8): PDFs exported from PowerPoint as "Notes Pages" print the
 * speaker notes onto the page itself. We can't reliably detect that, but we
 * can detect the common tell-tale: portrait pages where a landscape slide is
 * drawn in the top half. We warn; we don't block.
 */
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { canvasToBlob, downscaleToBlob, fitWithin, makeCanvas } from "../raster";
import { ImportError, type ImportOptions, type ImportResult, type RasterSlide } from "../types";

// Vite resolves this to a URL for the worker file (see ?url). The app sets
// GlobalWorkerOptions once via configurePdfWorker(); importing here keeps the
// package self-contained for tests that stub it.
let workerConfigured = false;
export function configurePdfWorker(workerSrc: string) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  workerConfigured = true;
}
export function isPdfWorkerConfigured() {
  return workerConfigured;
}

export const PDF_MAX_PAGES = 500;

export async function importPdf(file: File | Blob, opts: ImportOptions = {}): Promise<ImportResult> {
  const maxEdge = opts.maxEdge ?? 1920;
  const thumbEdge = opts.thumbEdge ?? 240;
  const signal = opts.signal;
  const warnings: string[] = [];

  const data = new Uint8Array(await file.arrayBuffer());
  let doc: PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableAutoFetch: true }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new ImportError("This PDF is password-protected. Remove the password and try again.", "password");
    if (name === "InvalidPDFException") throw new ImportError("This file is not a valid PDF.", "corrupt");
    throw new ImportError(`Could not open PDF: ${(e as Error)?.message ?? String(e)}`, "corrupt");
  }

  try {
    const total = doc.numPages;
    if (total === 0) throw new ImportError("The PDF has no pages.", "empty");
    if (total > PDF_MAX_PAGES) throw new ImportError(`The PDF has ${total} pages; the limit is ${PDF_MAX_PAGES}.`, "too-large");

    const slides: RasterSlide[] = [];
    let portraitWithTopSlide = 0;

    for (let i = 1; i <= total; i++) {
      if (signal?.aborted) throw new ImportError("Import cancelled.", "aborted");
      opts.onProgress?.({ fraction: (i - 1) / total, stage: `Rendering page ${i} of ${total}`, current: i, total });

      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const { scale } = fitWithin(base.width, base.height, maxEdge);
      const viewport = page.getViewport({ scale });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);

      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!ctx) throw new ImportError("Canvas 2D context unavailable.", "unsupported");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      // PDF.js types want CanvasRenderingContext2D; OffscreenCanvasRenderingContext2D is API-compatible.
      await page.render({ canvasContext: ctx as CanvasRenderingContext2D, viewport, intent: "display" }).promise;

      const mime: RasterSlide["mime"] = opts.jpegQuality !== undefined ? "image/jpeg" : "image/png";
      const blob = await canvasToBlob(canvas, mime, opts.jpegQuality);
      const thumb = await downscaleToBlob(canvas as CanvasImageSource, width, height, thumbEdge, "image/jpeg", 0.8);

      if (height > width * 1.2) {
        // heuristic for Notes Pages: portrait page, mostly white below the midline
        const sample = ctx.getImageData(0, Math.floor(height * 0.55), width, Math.max(1, Math.floor(height * 0.4))).data;
        let white = 0;
        const px = sample.length / 4;
        for (let p = 0; p < sample.length; p += 16) if (sample[p]! > 240 && sample[p + 1]! > 240 && sample[p + 2]! > 240) white++;
        if (white / (px / 4) > 0.92) portraitWithTopSlide++;
      }

      slides.push({ index: i - 1, width, height, mime, blob, thumb: thumb.blob, thumbWidth: thumb.width, thumbHeight: thumb.height });
      page.cleanup();
    }

    if (portraitWithTopSlide >= Math.max(1, Math.floor(total * 0.5))) {
      warnings.push(
        "This looks like a PowerPoint “Notes Pages” export: portrait pages with the slide at the top. Speaker notes printed on these pages WOULD be visible to the audience. Re-export as “Slides” (landscape) to be safe.",
      );
    }

    opts.onProgress?.({ fraction: 1, stage: "Done", current: total, total });
    return { slides, kind: "pdf", warnings };
  } finally {
    await doc.destroy();
  }
}

/**
 * Dispatches a File to the right importer. PPTX is detected and refused with
 * guidance (MVP) rather than rendered badly.
 */
import { configurePdfWorker, importImages, importPdf, ImportError, isPdfWorkerConfigured, isPptx, PDF_WORKER_URL, type ImportProgress, type RasterSlide } from "@bernou/import-core";

export type ImportOutcome = { ok: true; slides: RasterSlide[]; kind: "pdf" | "images"; warnings: string[] } | { ok: false; error: string; code: string };

export const PPTX_REFUSED_CODE = "pptx-export-required";

export async function runImport(fileOrFiles: File | File[], onProgress?: (p: ImportProgress) => void): Promise<ImportOutcome> {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const first = files[0];
  if (!first) return { ok: false, error: "No file selected.", code: "empty" };

  try {
    if (isPptx(first)) {
      return { ok: false, error: "PowerPoint files need to be exported to PDF first.", code: PPTX_REFUSED_CODE };
    }
    if (first.type === "application/pdf" || /\.pdf$/i.test(first.name)) {
      if (!isPdfWorkerConfigured()) configurePdfWorker(PDF_WORKER_URL);
      const r = await importPdf(first, { maxEdge: 1920, thumbEdge: 240, ...(onProgress ? { onProgress } : {}) });
      return { ok: true, slides: r.slides, kind: r.kind, warnings: r.warnings };
    }
    if (files.every((f) => f.type.startsWith("image/"))) {
      const r = await importImages(files, { maxEdge: 1920, thumbEdge: 240, ...(onProgress ? { onProgress } : {}) });
      return { ok: true, slides: r.slides, kind: r.kind, warnings: r.warnings };
    }
    return { ok: false, error: `Unsupported file type: ${first.type || first.name}. Use PDF, PNG, JPEG or WebP.`, code: "unsupported" };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: (e as Error).message ?? "Import failed.", code: "unknown" };
  }
}

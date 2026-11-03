/**
 * Dispatches a File to the right importer. PPTX is detected and refused with
 * guidance (MVP) rather than rendered badly.
 */
import { configurePdfWorker, importImages, importPdf, ImportError, isPdfWorkerConfigured, isPptx, PDF_WORKER_URL, type ImportProgress, type RasterSlide } from "@bernou/import-core";

export type ImportOutcome = { ok: true; slides: RasterSlide[]; kind: "pdf" | "images"; warnings: string[] } | { ok: false; error: string; code: string };

export const PPTX_REFUSED_CODE = "pptx-export-required";
const SUPPORTED_IMAGES = new Set(["image/png", "image/jpeg", "image/webp"]);

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const UNSUPPORTED = (name: string) => `Unsupported file type: ${name}. Use PDF, PNG, JPEG or WebP.`;

/** Why these files can't be imported together, or null if they can. Cheap, so it can run before anything is created. */
export function checkImportFiles(files: File[]): { error: string; code: string } | null {
  if (files.length === 0) return { error: "No file selected.", code: "empty" };
  if (files.some(isPptx)) return { error: "PowerPoint files need to be exported to PDF first.", code: PPTX_REFUSED_CODE };
  if (files.some(isPdf)) return files.length === 1 ? null : { error: "Choose one PDF at a time, or images, not a mix.", code: "mixed" };
  const images = files.filter((f) => SUPPORTED_IMAGES.has(f.type));
  if (images.length === 0) return { error: UNSUPPORTED(files[0]!.type || files[0]!.name), code: "unsupported" };
  return null;
}

export async function runImport(fileOrFiles: File | File[], onProgress?: (p: ImportProgress) => void): Promise<ImportOutcome> {
  const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
  const refused = checkImportFiles(files);
  if (refused) return { ok: false, ...refused };

  try {
    const options = { maxEdge: 1920, thumbEdge: 240, ...(onProgress ? { onProgress } : {}) };
    if (isPdf(files[0]!)) {
      if (!isPdfWorkerConfigured()) configurePdfWorker(PDF_WORKER_URL);
      const r = await importPdf(files[0]!, options);
      return { ok: true, slides: r.slides, kind: r.kind, warnings: r.warnings };
    }
    // By name, so slide2 comes before slide10 whatever order the picker gives.
    const images = files.filter((f) => SUPPORTED_IMAGES.has(f.type)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    const skipped = files.length - images.length;
    const r = await importImages(images, options);
    return { ok: true, slides: r.slides, kind: r.kind, warnings: skipped > 0 ? [...r.warnings, `${skipped} file${skipped === 1 ? " was" : "s were"} skipped: only PNG, JPEG and WebP images can be used.`] : r.warnings };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: (e as Error).message ?? "Import failed.", code: "unknown" };
  }
}

/**
 * Vite resolves `?url` to the emitted asset URL of the PDF.js worker. This
 * lives in import-core (which owns the pdfjs-dist dependency) so the app does
 * not need a direct dependency on pdfjs-dist.
 */
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const PDF_WORKER_URL: string = pdfWorkerUrl as string;

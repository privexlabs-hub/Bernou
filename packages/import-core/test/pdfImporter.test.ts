/**
 * PDF importer under Node using pdfjs-dist's legacy build + @napi-rs/canvas.
 * Verifies page counts, dimensions, thumbnail scaling and the notes-page
 * heuristic without a browser.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Image, Path2D, DOMMatrix, ImageData } from "@napi-rs/canvas";

const decks = resolve(__dirname, "../../../fixtures/decks");

beforeAll(() => {
  // Minimal DOM-ish shims so raster.ts can run in Node.
  const g = globalThis as Record<string, unknown>;
  // OffscreenCanvas shim: a real napi canvas with convertToBlob attached, so it
  // can be passed straight to drawImage() as a source.
  g.OffscreenCanvas = function (this: unknown, w: number, h: number) {
    const c = createCanvas(w, h) as unknown as { convertToBlob?: (o?: { type?: string; quality?: number }) => Promise<Blob> };
    c.convertToBlob = async (o) => {
      const type = (o?.type ?? "image/png") as "image/png" | "image/jpeg";
      const napi = c as unknown as ReturnType<typeof createCanvas>;
      const buf = type === "image/jpeg" ? napi.toBuffer("image/jpeg", Math.round((o?.quality ?? 0.9) * 100)) : napi.toBuffer("image/png");
      return new Blob([buf], { type });
    };
    return c;
  } as unknown;
  g.Image = Image;
  g.Path2D = Path2D;
  g.DOMMatrix = DOMMatrix;
  g.ImageData = ImageData;
});

async function load() {
  // pdfjs legacy build works in Node (no DOM required for rendering with a canvas factory)
  const mod = await import("../src/pdf/pdfImporter");
  return mod;
}

describe("importPdf", () => {
  it("renders every page of a 20-page deck with correct dimensions and thumbnails", async () => {
    const { importPdf } = await load();
    const file = new Blob([readFileSync(resolve(decks, "lecture-20.pdf"))], { type: "application/pdf" });
    const progress: number[] = [];
    const r = await importPdf(file, { maxEdge: 960, thumbEdge: 120, onProgress: (p) => progress.push(p.fraction) });
    expect(r.kind).toBe("pdf");
    expect(r.slides).toHaveLength(20);
    expect(r.warnings).toHaveLength(0);
    const first = r.slides[0]!;
    expect(first.width).toBe(960);
    expect(first.height).toBe(540);
    expect(first.mime).toBe("image/png");
    expect(first.blob.size).toBeGreaterThan(500);
    expect(first.thumbWidth).toBe(120);
    expect(first.thumbHeight).toBe(68);
    expect(progress.at(-1)).toBe(1);
    expect(r.slides.map((s) => s.index)).toEqual([...Array(20).keys()]);
  }, 60_000);

  it("flags a notes-pages PDF (P8)", async () => {
    const { importPdf } = await load();
    const file = new Blob([readFileSync(resolve(decks, "notes-pages.pdf"))], { type: "application/pdf" });
    const r = await importPdf(file, { maxEdge: 600, thumbEdge: 100 });
    expect(r.slides).toHaveLength(4);
    expect(r.warnings.join(" ")).toMatch(/Notes Pages/);
  }, 60_000);

  it("rejects a non-PDF with a typed error", async () => {
    const { importPdf } = await load();
    const { ImportError } = await import("../src/types");
    const file = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "application/pdf" });
    await expect(importPdf(file)).rejects.toBeInstanceOf(ImportError);
  });
});

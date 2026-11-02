#!/usr/bin/env node
/**
 * Generates deterministic PDF fixtures:
 *   lecture-20.pdf   — 20 landscape 16:9 slides, each with a large page number and a unique colour bar
 *   notes-pages.pdf  — 4 portrait "Notes Pages"-style pages (slide on top, white below with notes text)
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(new URL(".", import.meta.url).pathname);

async function lecture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= 20; i++) {
    const page = doc.addPage([960, 540]);
    const hue = (i * 37) % 360;
    const [r, g, b] = hsl(hue, 0.6, 0.5);
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.97, 0.97, 0.97) });
    page.drawRectangle({ x: 0, y: 470, width: 960, height: 70, color: rgb(r, g, b) });
    page.drawText(`Slide ${i}`, { x: 60, y: 230, size: 96, font, color: rgb(0.1, 0.1, 0.12) });
    page.drawText(`Fixture deck — page ${i} of 20`, { x: 60, y: 60, size: 20, font, color: rgb(0.4, 0.4, 0.45) });
  }
  writeFileSync(resolve(dir, "lecture-20.pdf"), await doc.save());
}

async function notesPages() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 4; i++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 72, y: 470, width: 468, height: 263, color: rgb(0.2, 0.3, 0.6) });
    page.drawText(`Slide ${i}`, { x: 100, y: 580, size: 40, font, color: rgb(1, 1, 1) });
    page.drawText("CANARY-NOTES-PRINTED: remember to mention the grant deadline", { x: 72, y: 400, size: 11, font, color: rgb(0, 0, 0) });
  }
  writeFileSync(resolve(dir, "notes-pages.pdf"), await doc.save());
}

function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

await lecture();
await notesPages();
console.log("wrote lecture-20.pdf, notes-pages.pdf");

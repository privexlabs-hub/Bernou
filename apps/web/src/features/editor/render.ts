/**
 * Drawing an edited frame: the picture settings, smooth-join blending and
 * overlays. The same code runs in the editor's preview and in the export
 * Worker, so overlays land in the file exactly where they were placed.
 */
import type { EditProject, Overlay } from "@/db/dexie";
import { PICTURE_RANGE } from "./project";

const clampPicture = (x: number) => Math.max(-PICTURE_RANGE, Math.min(PICTURE_RANGE, x));
const factor = (x: number) => +(1 + clampPicture(x) / 100).toFixed(4);

/** One filter string, valid both as CSS `filter` and as canvas `ctx.filter`. */
export function pictureFilter(p: EditProject["picture"]): string {
  if (p.brightness === 0 && p.contrast === 0 && p.saturation === 0) return "none";
  return `brightness(${factor(p.brightness)}) contrast(${factor(p.contrast)}) saturate(${factor(p.saturation)})`;
}

const FONT_SIZE = { s: 0.035, m: 0.05, l: 0.075 } as const;
const FONT_FAMILY = `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const LINE_HEIGHT = 1.25;
const PADDING_EM = 0.4;
const FILL_ALPHA = 0.28;

/**
 * Splits text into lines no wider than `width`, using the canvas's own metrics.
 * A word longer than a line is broken rather than dropped.
 */
export function textLayout(text: string, width: number, fontPx: number, measure?: (s: string) => number): string[] {
  const m = measure ?? ((s: string) => s.length * 0.5 * fontPx);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (m(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (m(rest) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && m(rest.slice(0, n)) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines.filter((l, i) => l || i < lines.length - 1);
}

/** Overlays active at original time `t`, drawn on a w×h frame. */
export function drawOverlays(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, overlays: Overlay[], t: number, w: number, h: number) {
  for (const o of overlays) {
    if (t < o.start || t >= o.end) continue;
    const x = o.x * w;
    const y = o.y * h;
    const bw = o.w * w;
    const bh = o.h * h;
    ctx.save();
    if (o.kind === "highlight") {
      if (o.style === "outline") {
        ctx.strokeStyle = o.color;
        ctx.lineWidth = Math.max(2, h * 0.006);
        ctx.lineJoin = "round";
        ctx.strokeRect(x, y, bw, bh);
      } else {
        ctx.globalAlpha *= FILL_ALPHA;
        ctx.fillStyle = o.color;
        ctx.fillRect(x, y, bw, bh);
      }
    } else {
      const fontPx = Math.round(h * FONT_SIZE[o.size]);
      ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
      ctx.textBaseline = "top";
      const pad = PADDING_EM * fontPx;
      const lines = textLayout(o.text, bw - 2 * pad, fontPx, (s) => ctx.measureText(s).width);
      const lh = fontPx * LINE_HEIGHT;
      if (o.box) {
        const widest = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.roundRect(x, y, Math.min(bw, widest + 2 * pad), lines.length * lh + 2 * pad - (lh - fontPx), pad / 2);
        ctx.fill();
      }
      ctx.fillStyle = o.color;
      lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lh));
    }
    ctx.restore();
  }
}

/** One source frame and its share of the picture; `t` is its original time. */
export interface FrameLayer {
  image: CanvasImageSource;
  weight: number;
  t: number;
}

/**
 * Draws one output frame: each source frame under the picture filter (in a
 * smooth join, the later one over the earlier one at its weight), then each
 * one's overlays, faded with it.
 */
export function drawFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layers: FrameLayer[], w: number, h: number, picture: EditProject["picture"], overlays: Overlay[]) {
  ctx.save();
  ctx.filter = pictureFilter(picture);
  layers.forEach((l, i) => {
    ctx.globalAlpha = i === 0 ? 1 : l.weight;
    ctx.drawImage(l.image, 0, 0, w, h);
  });
  ctx.restore();
  for (const l of layers) {
    ctx.save();
    ctx.globalAlpha = layers.length > 1 ? l.weight : 1;
    drawOverlays(ctx, overlays, l.t, w, h);
    ctx.restore();
  }
}

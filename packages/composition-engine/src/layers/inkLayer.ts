import { INK_COORD_MAX, type AudiencePayload, type InkStroke } from "@bernou/audience-protocol";
import { slideContentRect, type Rect } from "../geometry";
import type { AssetResolver, Ctx2D } from "../types";

const PEN_WIDTH = 0.005; // of the slide's height
const HIGHLIGHTER_WIDTH = 0.03;
const HIGHLIGHTER_ALPHA = 0.35;
const POINTER_RADIUS = 0.012;

const toX = (v: number, r: Rect) => r.x + (v / INK_COORD_MAX) * r.w;
const toY = (v: number, r: Rect) => r.y + (v / INK_COORD_MAX) * r.h;

function drawStroke(ctx: Ctx2D, stroke: InkStroke, r: Rect) {
  const { points } = stroke;
  const width = (stroke.tool === "highlighter" ? HIGHLIGHTER_WIDTH : PEN_WIDTH) * r.h;
  // One path per stroke, or a highlighter would darken wherever it overlaps itself.
  ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
  ctx.beginPath();
  if (points.length === 2) {
    ctx.fillStyle = stroke.color;
    ctx.arc(toX(points[0]!, r), toY(points[1]!, r), width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.moveTo(toX(points[0]!, r), toY(points[1]!, r));
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(toX(points[i]!, r), toY(points[i + 1]!, r));
  ctx.stroke();
}

/** Pen and highlighter marks: above the slide they belong to, below the camera. */
export function drawMarksLayer(ctx: Ctx2D, payload: AudiencePayload, assets: AssetResolver): void {
  const strokes = payload.ink?.strokes;
  if (!strokes?.length || !payload.slide || !assets.get(payload.slide.assetId)) return;
  const r = slideContentRect(payload);
  if (!r) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  for (const s of strokes) drawStroke(ctx, s, r);
  ctx.restore();
}

/** The laser dot: drawn last, so nothing can hide it. */
export function drawPointerLayer(ctx: Ctx2D, payload: AudiencePayload): void {
  const pointer = payload.ink?.pointer;
  const r = pointer && slideContentRect(payload);
  if (!pointer || !r) return;
  const x = toX(pointer.x, r);
  const y = toY(pointer.y, r);
  const radius = POINTER_RADIUS * r.h;
  ctx.save();
  ctx.fillStyle = "#ef4444";
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

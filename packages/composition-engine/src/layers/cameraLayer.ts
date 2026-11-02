import type { AudiencePayload } from "@bernou/audience-protocol";
import { cameraRect, coverCrop, fitContain } from "../geometry";
import type { Ctx2D, FrameSource } from "../types";

/**
 * Draws the camera overlay (circle or rounded rect) with cover-fit cropping,
 * optional mirror, shadow, border and opacity. Pure: no state between frames.
 *
 * In "camera-full" layout the camera fills the output (contain-fit) and the
 * overlay geometry is ignored.
 */
export function drawCameraLayer(ctx: Ctx2D, payload: AudiencePayload, camera: FrameSource | null): void {
  const c = payload.camera;
  if (!c.enabled || payload.layout === "blank" || payload.layout === "slide-full") return;
  const src = camera?.current() ?? null;
  const sw = camera?.width() ?? 0;
  const sh = camera?.height() ?? 0;
  const { width: W, height: H } = payload.output;

  if (payload.layout === "camera-full") {
    if (!src || sw === 0 || sh === 0) return;
    const r = fitContain(sw, sh, W, H);
    ctx.save();
    ctx.globalAlpha = c.opacity;
    if (c.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(src, W - r.x - r.w, r.y, r.w, r.h);
    } else {
      ctx.drawImage(src, r.x, r.y, r.w, r.h);
    }
    ctx.restore();
    return;
  }

  const r = cameraRect(c, W, H);
  const radius = c.shape === "circle" ? r.w / 2 : Math.min(r.w, r.h) * c.cornerRadius;

  const pathShape = () => {
    ctx.beginPath();
    if (c.shape === "circle") ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2);
    else roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.closePath();
  };

  ctx.save();
  ctx.globalAlpha = c.opacity;

  // Shadow is drawn as a filled shape underneath so it is identical across engines.
  if (c.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.max(8, r.w * 0.08);
    ctx.shadowOffsetY = Math.max(2, r.w * 0.02);
    pathShape();
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }

  // Video, clipped
  ctx.save();
  pathShape();
  ctx.clip();
  if (src && sw > 0 && sh > 0) {
    const crop = coverCrop(sw, sh, r.w, r.h);
    if (c.mirror) {
      ctx.translate(r.x + r.w, r.y);
      ctx.scale(-1, 1);
      ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, r.w, r.h);
    } else {
      ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, r.x, r.y, r.w, r.h);
    }
  } else {
    // Camera enabled but no frame yet: neutral placeholder, never text.
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  ctx.restore();

  // Border
  if (c.border.width > 0) {
    pathShape();
    ctx.lineWidth = c.border.width;
    ctx.strokeStyle = c.border.color;
    ctx.stroke();
  }
  ctx.restore();
}

export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
}

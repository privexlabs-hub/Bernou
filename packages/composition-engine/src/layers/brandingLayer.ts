import type { AudiencePayload } from "@bernou/audience-protocol";
import type { AssetResolver, Ctx2D } from "../types";

/**
 * Optional title / logo in a corner. The title is the only free text the
 * engine ever draws, and it comes from the length-capped branding field.
 */
export function drawBrandingLayer(ctx: Ctx2D, payload: AudiencePayload, assets: AssetResolver): void {
  const b = payload.branding;
  if (!b || payload.layout === "blank") return;
  const { width: W, height: H } = payload.output;
  const pad = Math.round(H * 0.03);
  const fontPx = Math.round(H * 0.028);
  const logo = b.logoAssetId ? assets.get(b.logoAssetId) : null;
  const logoH = logo ? Math.round(H * 0.06) : 0;
  const logoW = logo ? Math.round(logoH * (("width" in logo && typeof logo.width === "number" ? logo.width : logoH) / ("height" in logo && typeof logo.height === "number" ? logo.height : logoH))) : 0;

  ctx.save();
  ctx.font = `600 ${fontPx}px Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  const textW = b.title ? ctx.measureText(b.title).width : 0;
  const gap = logo && b.title ? Math.round(fontPx * 0.6) : 0;
  const totalW = logoW + gap + textW;
  const totalH = Math.max(logoH, fontPx);

  const left = b.position === "tl" || b.position === "bl";
  const top = b.position === "tl" || b.position === "tr";
  const x0 = left ? pad : W - pad - totalW;
  const y0 = top ? pad : H - pad - totalH;
  const cy = y0 + totalH / 2;

  // subtle plate for legibility over any slide
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  const plateX = x0 - pad * 0.5;
  const plateY = y0 - pad * 0.35;
  ctx.fillRect(plateX, plateY, totalW + pad, totalH + pad * 0.7);

  let x = x0;
  if (logo) {
    ctx.drawImage(logo, x, cy - logoH / 2, logoW, logoH);
    x += logoW + gap;
  }
  if (b.title) {
    ctx.fillStyle = b.color;
    ctx.textAlign = "left";
    ctx.fillText(b.title, x, cy);
  }
  ctx.restore();
}

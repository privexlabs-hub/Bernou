import type { AudiencePayload } from "@bernou/audience-protocol";
import { fitContain } from "../geometry";
import type { AssetResolver, Ctx2D } from "../types";

/** Draws the active slide letterboxed into the full output. */
export function drawSlideLayer(ctx: Ctx2D, payload: AudiencePayload, assets: AssetResolver): void {
  const { width, height } = payload.output;
  if (payload.layout === "blank" || payload.layout === "camera-full" || !payload.slide) return;
  const img = assets.get(payload.slide.assetId);
  if (!img) return;
  const r = fitContain(payload.slide.width, payload.slide.height, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
}

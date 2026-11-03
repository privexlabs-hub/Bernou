import type { AudiencePayload } from "@bernou/audience-protocol";
import { slideContentRect } from "../geometry";
import type { AssetResolver, Ctx2D } from "../types";

/** Draws the active slide letterboxed into the full output. */
export function drawSlideLayer(ctx: Ctx2D, payload: AudiencePayload, assets: AssetResolver): void {
  const r = slideContentRect(payload);
  if (!r || !payload.slide) return;
  const img = assets.get(payload.slide.assetId);
  if (!img) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x, r.y, r.w, r.h);
}

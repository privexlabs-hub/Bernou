/**
 * Payload constructor. Import is restricted by .dependency-cruiser.cjs to
 * apps/web/src/stores/audienceBridge.ts (plus the audience/preview consumers
 * that only read). It accepts ONLY individually named public values — never a
 * store object — so a private slice cannot be passed in by accident.
 *
 * Every value is clamped/normalised here so the renderer never sees an
 * out-of-bounds overlay.
 */
import {
  OUTPUT_PROFILES,
  PROTOCOL_VERSION,
  MAX_BRANDING_TITLE_LENGTH,
  type AudienceLayout,
  type AudiencePayload,
  type BrandingPosition,
  type CameraShape,
  type OutputProfileName,
  type SlideRef,
  type CameraSpec,
} from "./payload";
import { validatePayload } from "./schema";

export interface BuildPayloadInput {
  seq: number;
  profile: OutputProfileName;
  background: string;
  layout: AudienceLayout;
  slide: SlideRef | null;
  camera: {
    enabled: boolean;
    deviceId: string | null;
    shape: CameraShape;
    x: number;
    y: number;
    size: number;
    aspect: number;
    cornerRadius: number;
    borderWidth: number;
    borderColor: string;
    shadow: boolean;
    mirror: boolean;
    opacity: number;
  };
  branding: { title: string | null; logoAssetId: string | null; position: BrandingPosition; color: string } | null;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** Overlay height in normalised output units given its width and aspect. */
export function overlayHeightNormalised(size: number, aspect: number, outputW: number, outputH: number): number {
  // size is width as a fraction of output width; convert to height as fraction of output height
  const pxW = size * outputW;
  const pxH = pxW / aspect;
  return pxH / outputH;
}

/** Clamp an overlay so it stays fully inside the output rectangle. */
export function clampCamera(c: BuildPayloadInput["camera"], outputW: number, outputH: number): CameraSpec {
  const shape = c.shape;
  const aspect = shape === "circle" ? 1 : clamp(c.aspect, 0.25, 4);
  // A circle must fit inside the output even on the shorter axis.
  const maxSizeByHeight = (outputH / outputW) * aspect; // width fraction at which height == outputH
  const size = clamp(c.size, 0.05, Math.min(1, maxSizeByHeight));
  const hNorm = overlayHeightNormalised(size, aspect, outputW, outputH);
  const x = clamp(c.x, 0, Math.max(0, 1 - size));
  const y = clamp(c.y, 0, Math.max(0, 1 - hNorm));
  return {
    enabled: c.enabled,
    deviceId: c.deviceId,
    shape,
    x,
    y,
    size,
    aspect,
    cornerRadius: clamp(c.cornerRadius, 0, 0.5),
    border: { width: clamp(c.borderWidth, 0, 64), color: c.borderColor },
    shadow: c.shadow,
    mirror: c.mirror,
    opacity: clamp(c.opacity, 0, 1),
  };
}

export function buildAudiencePayload(input: BuildPayloadInput): AudiencePayload {
  const { width, height } = OUTPUT_PROFILES[input.profile];
  const payload: AudiencePayload = {
    v: PROTOCOL_VERSION,
    seq: input.seq,
    output: { profile: input.profile, width, height, background: input.background },
    layout: input.layout,
    slide: input.slide ? { assetId: input.slide.assetId, width: input.slide.width, height: input.slide.height } : null,
    camera: clampCamera(input.camera, width, height),
    branding: input.branding
      ? {
          title: input.branding.title ? input.branding.title.slice(0, MAX_BRANDING_TITLE_LENGTH) : null,
          logoAssetId: input.branding.logoAssetId,
          position: input.branding.position,
          color: input.branding.color,
        }
      : null,
  };
  // Validate our own output: if this throws, it's a bug in this file, and
  // nothing is sent.
  return validatePayload(payload);
}

export function blankPayload(seq: number, profile: OutputProfileName = "1080p"): AudiencePayload {
  return buildAudiencePayload({
    seq,
    profile,
    background: "#0b0d12",
    layout: "blank",
    slide: null,
    camera: {
      enabled: false,
      deviceId: null,
      shape: "circle",
      x: 0.78,
      y: 0.68,
      size: 0.18,
      aspect: 1,
      cornerRadius: 0.1,
      borderWidth: 4,
      borderColor: "#ffffff",
      shadow: true,
      mirror: false,
      opacity: 1,
    },
    branding: null,
  });
}

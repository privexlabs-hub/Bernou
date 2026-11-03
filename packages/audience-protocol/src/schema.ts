/**
 * Runtime schema for AudiencePayload. `.strict()` everywhere: unknown keys are
 * REJECTED, not ignored. String lengths are capped so no large text blob can
 * ride along in an allowed field.
 */
import { z } from "zod";
import { INK_COLORS, INK_COORD_MAX, MAX_BRANDING_TITLE_LENGTH, MAX_INK_POINTS, MAX_INK_STROKES, OUTPUT_PROFILES, PROTOCOL_VERSION, type AudiencePayload } from "./payload";

const cssColor = z.string().min(1).max(64).regex(/^[#a-zA-Z0-9(),.% -]+$/, "unsafe colour string");
const assetId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "asset ids are opaque slugs");
const unit = z.number().min(0).max(1);

export const OutputSpecSchema = z
  .object({
    profile: z.enum(["480p", "720p", "1080p"]),
    width: z.number().int().positive().max(7680),
    height: z.number().int().positive().max(4320),
    background: cssColor,
  })
  .strict()
  .refine((o) => OUTPUT_PROFILES[o.profile].width === o.width && OUTPUT_PROFILES[o.profile].height === o.height, {
    message: "width/height must match the named profile",
  });

export const SlideRefSchema = z
  .object({
    assetId,
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  })
  .strict();

export const CameraSpecSchema = z
  .object({
    enabled: z.boolean(),
    // deviceId is an opaque browser-issued identifier (base64url-ish, up to ~64-128 chars).
    deviceId: z.string().max(256).nullable(),
    shape: z.enum(["circle", "rect"]),
    x: unit,
    y: unit,
    size: z.number().min(0.05).max(1),
    aspect: z.number().min(0.25).max(4),
    cornerRadius: z.number().min(0).max(0.5),
    border: z.object({ width: z.number().min(0).max(64), color: cssColor }).strict(),
    shadow: z.boolean(),
    mirror: z.boolean(),
    opacity: unit,
  })
  .strict();

export const BrandingSpecSchema = z
  .object({
    title: z.string().max(MAX_BRANDING_TITLE_LENGTH).nullable(),
    logoAssetId: assetId.nullable(),
    position: z.enum(["tl", "tr", "bl", "br"]),
    color: cssColor,
  })
  .strict();

const inkCoord = z.number().int().min(0).max(INK_COORD_MAX);

export const InkStrokeSchema = z
  .object({
    tool: z.enum(["pen", "highlighter"]),
    color: z.enum(INK_COLORS),
    points: z
      .array(inkCoord)
      .min(2)
      .max(MAX_INK_POINTS * 2)
      .refine((p) => p.length % 2 === 0, { message: "points come in x, y pairs" })
      .readonly(),
  })
  .strict();

export const InkSpecSchema = z
  .object({
    pointer: z.object({ x: inkCoord, y: inkCoord }).strict().nullable(),
    strokes: z.array(InkStrokeSchema).max(MAX_INK_STROKES).readonly(),
  })
  .strict()
  .refine((ink) => ink.strokes.reduce((n, s) => n + s.points.length / 2, 0) <= MAX_INK_POINTS, { message: `at most ${MAX_INK_POINTS} ink points per slide` });

export const AudiencePayloadSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    seq: z.number().int().nonnegative(),
    output: OutputSpecSchema,
    layout: z.enum(["slide-full", "slide-with-camera", "camera-full", "blank"]),
    slide: SlideRefSchema.nullable(),
    camera: CameraSpecSchema,
    branding: BrandingSpecSchema.nullable(),
    ink: InkSpecSchema.nullable(),
  })
  .strict();

// Compile-time guarantee that the schema and the interface agree.
type SchemaOutput = z.infer<typeof AudiencePayloadSchema>;
const _assertSchemaMatchesType: AudiencePayload extends SchemaOutput ? (SchemaOutput extends AudiencePayload ? true : never) : never = true;
void _assertSchemaMatchesType;

export function validatePayload(input: unknown): AudiencePayload {
  return AudiencePayloadSchema.parse(input) as AudiencePayload;
}

export function safeValidatePayload(input: unknown): { ok: true; payload: AudiencePayload } | { ok: false; error: string } {
  const r = AudiencePayloadSchema.safeParse(input);
  if (r.success) return { ok: true, payload: r.data as AudiencePayload };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

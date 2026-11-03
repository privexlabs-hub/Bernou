/**
 * Message envelopes that cross between the presenter window and the audience
 * window over a BroadcastChannel. Every envelope is validated on BOTH ends.
 */
import { z } from "zod";
import { AudiencePayloadSchema } from "./schema";
import type { AudiencePayload } from "./payload";

export const CHANNEL_NAME = "bernou-audience-v1";

const assetId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** Audience window announces itself; presenter replies with a full `payload` and any missing assets. */
export const HelloMessageSchema = z.object({ type: z.literal("hello"), from: z.literal("audience") }).strict();

/** Presenter publishes the complete current payload (never a diff — no hidden state accumulates). */
export const PayloadMessageSchema = z.object({ type: z.literal("payload"), payload: AudiencePayloadSchema }).strict();

/** Audience asks for a rasterised asset it does not have cached. */
export const AssetRequestMessageSchema = z.object({ type: z.literal("asset-request"), assetId }).strict();

/**
 * A rasterised slide or logo bitmap. Blobs are structured-cloneable so they
 * travel over BroadcastChannel. The Blob MUST be an image MIME type; the
 * receiver re-checks this before decoding.
 */
export const AssetMessageSchema = z
  .object({
    type: z.literal("asset"),
    assetId,
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    blob: z.instanceof(Blob),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
  })
  .strict();

/** Emergency stop: audience blanks to the neutral frame and stops its camera. */
export const BlankMessageSchema = z.object({ type: z.literal("blank") }).strict();

/** Presenter window is closing; audience shows a neutral frame. */
export const ByeMessageSchema = z.object({ type: z.literal("bye") }).strict();

/** Why the audience window has no camera, by code only: no device names or browser text. */
export const AudienceCameraErrorSchema = z.enum(["denied", "in-use", "not-found", "not-matched", "ended", "unknown"]);
export type AudienceCameraError = z.infer<typeof AudienceCameraErrorSchema>;

/** Audience window's periodic heartbeat, so the presenter knows it's there and whether its camera works. */
export const AudienceStatusMessageSchema = z.object({ type: z.literal("audience-status"), cameraError: AudienceCameraErrorSchema.nullable() }).strict();

export const PresenterToAudienceSchema = z.discriminatedUnion("type", [
  PayloadMessageSchema,
  AssetMessageSchema,
  BlankMessageSchema,
  ByeMessageSchema,
]);
export const AudienceToPresenterSchema = z.discriminatedUnion("type", [HelloMessageSchema, AssetRequestMessageSchema, AudienceStatusMessageSchema]);

export type HelloMessage = z.infer<typeof HelloMessageSchema>;
export type PayloadMessage = { type: "payload"; payload: AudiencePayload };
export type AssetRequestMessage = z.infer<typeof AssetRequestMessageSchema>;
export type AssetMessage = z.infer<typeof AssetMessageSchema>;
export type BlankMessage = z.infer<typeof BlankMessageSchema>;
export type ByeMessage = z.infer<typeof ByeMessageSchema>;

export type PresenterToAudience = PayloadMessage | AssetMessage | BlankMessage | ByeMessage;
export type AudienceStatusMessage = z.infer<typeof AudienceStatusMessageSchema>;
export type AudienceToPresenter = HelloMessage | AssetRequestMessage | AudienceStatusMessage;

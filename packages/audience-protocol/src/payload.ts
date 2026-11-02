/**
 * AudiencePayload — THE privacy boundary.
 *
 * This is the only shape of data that may ever reach the audience renderer.
 * Everything the audience sees is derived from this object plus live media
 * frames from sources the payload explicitly names (a camera deviceId).
 *
 * Deliberately ABSENT, and must stay absent:
 *   - the speech script, sections, or any script text
 *   - teleprompter state (position, speed, font, colours)
 *   - speaker notes
 *   - recording state or controls
 *   - microphone settings, levels, device lists
 *   - navigation state beyond the current rasterised slide
 *   - file names, session names, deck titles, slide text layers
 *
 * The ONLY free text allowed is `branding.title`, which the presenter sets in
 * a dedicated "visible to audience" field and which is length-capped.
 *
 * Any change to this file requires a privacy review (see CODEOWNERS) and must
 * keep the privacy test suite green (apps/web/tests/privacy).
 */

export const PROTOCOL_VERSION = 1 as const;

export const OUTPUT_PROFILES = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const;

export type OutputProfileName = keyof typeof OUTPUT_PROFILES;

export type AudienceLayout = "slide-full" | "slide-with-camera" | "camera-full" | "blank";

export type CameraShape = "circle" | "rect";

export type BrandingPosition = "tl" | "tr" | "bl" | "br";

/** Maximum length of the audience-visible title. */
export const MAX_BRANDING_TITLE_LENGTH = 120;

export interface OutputSpec {
  readonly profile: OutputProfileName;
  readonly width: number;
  readonly height: number;
  /** CSS colour drawn behind letterboxed slides. */
  readonly background: string;
}

/** Reference to a rasterised slide. Bitmaps travel separately as assets. */
export interface SlideRef {
  readonly assetId: string;
  readonly width: number;
  readonly height: number;
}

export interface CameraSpec {
  readonly enabled: boolean;
  /** Lets the audience window open the same camera. Never a label or name. */
  readonly deviceId: string | null;
  readonly shape: CameraShape;
  /** Normalised 0..1 coordinates of the overlay's top-left corner. */
  readonly x: number;
  readonly y: number;
  /** Normalised width of the overlay relative to output width (0..1). */
  readonly size: number;
  /** Width / height. Ignored for circle (always 1). */
  readonly aspect: number;
  /** Corner radius as a fraction of the shorter side, rect mode only (0..0.5). */
  readonly cornerRadius: number;
  readonly border: { readonly width: number; readonly color: string };
  readonly shadow: boolean;
  readonly mirror: boolean;
  readonly opacity: number;
}

export interface BrandingSpec {
  readonly title: string | null;
  readonly logoAssetId: string | null;
  readonly position: BrandingPosition;
  readonly color: string;
}

export interface AudiencePayload {
  readonly v: typeof PROTOCOL_VERSION;
  /** Monotonic sequence number; receivers apply last-writer-wins. */
  readonly seq: number;
  readonly output: OutputSpec;
  readonly layout: AudienceLayout;
  readonly slide: SlideRef | null;
  readonly camera: CameraSpec;
  readonly branding: BrandingSpec | null;
}

/**
 * Exhaustive, ordered list of the top-level keys a payload may contain.
 * Privacy test P1 asserts Object.keys(payload) deep-equals this list.
 */
export const AUDIENCE_PAYLOAD_KEYS = ["v", "seq", "output", "layout", "slide", "camera", "branding"] as const;

export const CAMERA_KEYS = [
  "enabled",
  "deviceId",
  "shape",
  "x",
  "y",
  "size",
  "aspect",
  "cornerRadius",
  "border",
  "shadow",
  "mirror",
  "opacity",
] as const;

export const OUTPUT_KEYS = ["profile", "width", "height", "background"] as const;
export const SLIDE_KEYS = ["assetId", "width", "height"] as const;
export const BRANDING_KEYS = ["title", "logoAssetId", "position", "color"] as const;

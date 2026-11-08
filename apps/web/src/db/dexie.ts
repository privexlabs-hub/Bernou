/**
 * Local persistence (IndexedDB via Dexie). Everything stays on the device.
 * There is no network sync anywhere in Bernou.
 *
 * Tables:
 *   sessions   — a presentation session (title, timestamps, settings)
 *   slides     — rasterised slide bitmaps (PNG/JPEG/WebP Blobs) per session
 *   scripts    — the speech script sections per session           (PRIVATE)
 *   notes      — per-slide speaker notes per session             (PRIVATE)
 *   recordings — metadata for recordings stored in OPFS (stage THIRD)
 *   settings   — app-wide key/value settings
 */
import type { InkStroke } from "@bernou/audience-protocol";
import Dexie, { type EntityTable } from "dexie";

export interface SessionRecord {
  id: string;
  /** Goes up each time the slides are replaced. Missing on older rows, meaning 0. */
  deckRevision?: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Name of the imported file, shown ONLY in the presenter UI. */
  sourceFileName: string | null;
  sourceKind: "pdf" | "images" | "none";
  slideCount: number;
  /** Public composition settings (these DO cross into the audience payload). */
  composition: CompositionSettings;
  /** Private teleprompter preferences. */
  teleprompter: TeleprompterSettings;
  /** Index of the slide last shown. */
  activeSlideIndex: number;
}

export interface CompositionSettings {
  profile: "480p" | "720p" | "1080p";
  background: string;
  layout: "slide-full" | "slide-with-camera" | "camera-full" | "blank";
  camera: {
    enabled: boolean;
    shape: "circle" | "rect";
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
  branding: { enabled: boolean; title: string; position: "tl" | "tr" | "bl" | "br"; color: string };
}

export interface TeleprompterSettings {
  speed: number; // px per second
  fontSize: number; // px
  textColor: string;
  backgroundColor: string;
  align: "left" | "center";
  /** Fraction of the panel height (0..1) at which the reading line sits. */
  readingLine: number;
  /** Fraction of panel height that is visible above/below reading line (0..1). */
  readingZone: number;
  mirror: boolean;
  /** Jump to the section linked to the active slide. Optional, and off unless chosen. */
  followSlides: boolean;
  /** The floating prompter's own layout (see features/teleprompter/textLayout). */
  floatFontSize: number;
  floatReadingLine: number;
  floatReadingZone: number;
  floatAlign: "left" | "center";
}

export interface SlideRecord {
  id: string; // `${sessionId}:${index}`
  sessionId: string;
  index: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  blob: Blob;
  thumb: Blob;
  thumbWidth: number;
  thumbHeight: number;
}

/** PRIVATE */
export interface ScriptRecord {
  sessionId: string;
  sections: Array<{ id: string; title: string; body: string; slideIndex: number | null }>;
  updatedAt: number;
}

/** PRIVATE */
export interface NoteRecord {
  id: string; // `${sessionId}:${slideIndex}`
  sessionId: string;
  slideIndex: number;
  body: string;
  updatedAt: number;
}

export interface RecordingRecord {
  id: string;
  sessionId: string | null;
  title: string;
  createdAt: number;
  durationMs: number;
  mime: string;
  extension: string;
  bytes: number;
  width: number;
  height: number;
  /** OPFS path where the file lives. */
  opfsPath: string;
  savedToDisk: boolean;
  /** Missing on rows from before this existed, which were complete. */
  status?: "recording" | "complete" | "interrupted";
  /** Set on a recording made in the editor: the id of the recording it was edited from. */
  editedFrom?: string;
}

/** A time range in the ORIGINAL recording's seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

/** The fixed colours overlays can use. */
export const OVERLAY_COLORS = ["#ffffff", "#111827", "#f59e0b", "#ef4444", "#22c55e", "#3b82f6"] as const;
export type OverlayColor = (typeof OVERLAY_COLORS)[number];

interface OverlayBase extends TimeRange {
  id: string;
  /** Position and size as fractions of the frame (0..1). */
  x: number;
  y: number;
  w: number;
  h: number;
  color: OverlayColor;
}
export interface TextOverlay extends OverlayBase {
  kind: "text";
  text: string;
  size: "s" | "m" | "l";
  /** A backing box behind the text, for legibility. */
  box: boolean;
}
export interface HighlightOverlay extends OverlayBase {
  kind: "highlight";
  style: "outline" | "fill";
}
export type Overlay = TextOverlay | HighlightOverlay;

/** An imported audio file on the edited video's timeline. Its file is in OPFS `editor-audio/<assetId>`. */
export interface AddedTrack {
  id: string;
  assetId: string;
  name: string;
  /** Output-timeline seconds where it starts. */
  start: number;
  /** Seconds into the file where it starts, and how much of the file plays per pass. */
  trimIn: number;
  length: number;
  volumeDb: number;
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  /** Dips while someone speaks. */
  duck: boolean;
  /** A voice: makes music that's set to dip go down. */
  voice: boolean;
}

/**
 * A recording's edits. Nothing here changes the original: export renders a new
 * file from the original plus this. All times are in the original's seconds.
 */
export interface EditProject {
  /** The recording being edited. */
  id: string;
  updatedAt: number;
  trim: TimeRange;
  cuts: TimeRange[];
  smoothJoins: boolean;
  audio: {
    /** The recording's own sound. */
    volumeDb: number;
    mutes: TimeRange[];
    denoise: { on: boolean; strength: number };
    /** Off: the export has none of the recording's sound. Offset: + plays it later against the picture. */
    original: { on: boolean; offsetMs: number };
    /** Imported audio, placed on the edited video's timeline. */
    tracks: AddedTrack[];
    /** How far music set to dip goes down while someone speaks. */
    ducking: { depthDb: number };
  };
  /** -50..50 each; 0 is unchanged. */
  picture: { brightness: number; contrast: number; saturation: number };
  overlays: Overlay[];
}

/** One slide's marks. The same shape the audience payload carries. */
export interface InkRecord {
  id: string;
  sessionId: string;
  slideIndex: number;
  strokes: InkStroke[];
  updatedAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class BernouDB extends Dexie {
  sessions!: EntityTable<SessionRecord, "id">;
  slides!: EntityTable<SlideRecord, "id">;
  scripts!: EntityTable<ScriptRecord, "sessionId">;
  notes!: EntityTable<NoteRecord, "id">;
  recordings!: EntityTable<RecordingRecord, "id">;
  settings!: EntityTable<SettingRecord, "key">;
  ink!: EntityTable<InkRecord, "id">;
  editProjects!: EntityTable<EditProject, "id">;

  constructor(name = "bernou") {
    super(name);
    this.version(1).stores({
      sessions: "id, updatedAt, createdAt",
      slides: "id, sessionId, [sessionId+index]",
      scripts: "sessionId, updatedAt",
      notes: "id, sessionId, [sessionId+slideIndex]",
      recordings: "id, sessionId, createdAt",
      settings: "key",
    });
    // Every table is listed again: a version is the whole schema, not a change to it.
    this.version(2).stores({
      sessions: "id, updatedAt, createdAt",
      slides: "id, sessionId, [sessionId+index]",
      scripts: "sessionId, updatedAt",
      notes: "id, sessionId, [sessionId+slideIndex]",
      recordings: "id, sessionId, createdAt",
      settings: "key",
      ink: "id, sessionId, [sessionId+slideIndex]",
    });
    this.version(3).stores({
      sessions: "id, updatedAt, createdAt",
      slides: "id, sessionId, [sessionId+index]",
      scripts: "sessionId, updatedAt",
      notes: "id, sessionId, [sessionId+slideIndex]",
      recordings: "id, sessionId, createdAt",
      settings: "key",
      ink: "id, sessionId, [sessionId+slideIndex]",
      editProjects: "id",
    });
  }
}

let instance: BernouDB | null = null;
export function db(): BernouDB {
  if (!instance) instance = new BernouDB();
  return instance;
}

/** Tests only: swap in a fresh database. */
export function __setDbForTests(d: BernouDB | null) {
  instance = d;
}

export const DEFAULT_COMPOSITION: CompositionSettings = {
  profile: "1080p",
  background: "#0b0d12",
  layout: "slide-with-camera",
  camera: {
    enabled: false,
    shape: "circle",
    x: 0.78,
    y: 0.66,
    size: 0.18,
    aspect: 16 / 9,
    cornerRadius: 0.12,
    borderWidth: 4,
    borderColor: "#ffffff",
    shadow: true,
    mirror: true,
    opacity: 1,
  },
  branding: { enabled: false, title: "", position: "bl", color: "#ffffff" },
};

export const DEFAULT_TELEPROMPTER: TeleprompterSettings = {
  speed: 40,
  fontSize: 28,
  textColor: "#f4f4f5",
  backgroundColor: "#0b0d12",
  align: "left",
  readingLine: 0.35,
  readingZone: 0.6,
  mirror: false,
  followSlides: false,
  // As CAMERA_LAYOUT in textLayout.ts; a unit test keeps the two the same.
  floatFontSize: 22,
  floatReadingLine: 0.1,
  floatReadingZone: 0.5,
  floatAlign: "center",
};

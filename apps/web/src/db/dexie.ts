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
import Dexie, { type EntityTable } from "dexie";

export interface SessionRecord {
  id: string;
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
};

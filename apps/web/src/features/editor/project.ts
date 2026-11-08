/** Making and checking edit projects. */
import type { EditProject, RecordingRecord } from "@/db/dexie";

export const OVERLAY_TEXT_MAX = 200;
export const VOLUME_DB = { min: -20, max: 12 } as const;
export const PICTURE_RANGE = 50;

/** The whole recording, nothing changed. */
export function newEditProject(rec: Pick<RecordingRecord, "id" | "durationMs">): EditProject {
  return {
    id: rec.id,
    updatedAt: Date.now(),
    trim: { start: 0, end: rec.durationMs / 1000 },
    cuts: [],
    smoothJoins: false,
    audio: { volumeDb: 0, mutes: [], denoise: { on: false, strength: 1 }, original: { on: true, offsetMs: 0 }, tracks: [], ducking: { depthDb: -12 } },
    picture: { brightness: 0, contrast: 0, saturation: 0 },
    overlays: [],
  };
}

export const OFFSET_MS = 2000;

/** Fills in what projects saved before a field existed don't have. */
export function normalizeProject(p: EditProject): EditProject {
  const a = p.audio as Partial<EditProject["audio"]> & Pick<EditProject["audio"], "volumeDb" | "mutes" | "denoise">;
  return {
    ...p,
    audio: {
      ...a,
      original: a.original ?? { on: true, offsetMs: 0 },
      tracks: a.tracks ?? [],
      ducking: a.ducking ?? { depthDb: -12 },
    },
  };
}

export const isNeutralPicture = (p: EditProject["picture"]) => p.brightness === 0 && p.contrast === 0 && p.saturation === 0;

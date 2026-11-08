/** Edits as pure functions of the project, each one an undoable step via the store's `change`. */
import type { AddedTrack, EditProject, Overlay, OverlayColor, TimeRange } from "@/db/dexie";
import { normalizeRanges } from "./timeline";
import { OVERLAY_TEXT_MAX } from "./project";

const newId = () => Math.random().toString(36).slice(2, 10);

export const removeSection = (r: TimeRange, duration: number) => (p: EditProject): EditProject => ({ ...p, cuts: normalizeRanges([...p.cuts, r], duration) });

/** Puts back every part of the removed sections that overlaps `r`. */
export const restoreSection = (r: TimeRange, duration: number) => (p: EditProject): EditProject => ({ ...p, cuts: subtract(p.cuts, r, duration) });

export const muteSection = (r: TimeRange, duration: number) => (p: EditProject): EditProject => ({ ...p, audio: { ...p.audio, mutes: normalizeRanges([...p.audio.mutes, r], duration) } });

export const unmuteSection = (r: TimeRange, duration: number) => (p: EditProject): EditProject => ({ ...p, audio: { ...p.audio, mutes: subtract(p.audio.mutes, r, duration) } });

/** Picture-only cut: black there, the sound carries on, the length is unchanged. */
export const blankPicture = (r: TimeRange, duration: number) => (p: EditProject): EditProject => ({ ...p, blanks: normalizeRanges([...p.blanks, r], duration) });

export const unblankPicture = (r: TimeRange, duration: number) => (p: EditProject): EditProject => ({ ...p, blanks: subtract(p.blanks, r, duration) });

export const setTrim = (trim: TimeRange) => (p: EditProject): EditProject => ({ ...p, trim });

function subtract(ranges: TimeRange[], r: TimeRange, duration: number): TimeRange[] {
  const out: TimeRange[] = [];
  for (const x of normalizeRanges(ranges, duration)) {
    if (x.end <= r.start || x.start >= r.end) out.push(x);
    else {
      if (x.start < r.start) out.push({ start: x.start, end: r.start });
      if (x.end > r.end) out.push({ start: r.end, end: x.end });
    }
  }
  return out;
}

export function newText(r: TimeRange): Overlay {
  return { id: newId(), kind: "text", start: r.start, end: r.end, x: 0.08, y: 0.78, w: 0.6, h: 0.14, color: "#ffffff" as OverlayColor, text: "Your text", size: "m", box: true };
}

export function newHighlight(r: TimeRange): Overlay {
  return { id: newId(), kind: "highlight", start: r.start, end: r.end, x: 0.35, y: 0.3, w: 0.3, h: 0.3, color: "#f59e0b" as OverlayColor, style: "outline" };
}

export const addOverlay = (o: Overlay) => (p: EditProject): EditProject => ({ ...p, overlays: [...p.overlays, o] });

export const updateOverlay = (id: string, patch: Partial<Overlay>) => (p: EditProject): EditProject => ({
  ...p,
  overlays: p.overlays.map((o) => (o.id === id ? clampOverlay({ ...o, ...patch } as Overlay) : o)),
});

export const deleteOverlay = (id: string) => (p: EditProject): EditProject => ({ ...p, overlays: p.overlays.filter((o) => o.id !== id) });

/** Keeps an overlay inside the frame, at least a little visible, its text within the limit. */
export function clampOverlay(o: Overlay): Overlay {
  const w = Math.min(1, Math.max(0.03, o.w));
  const h = Math.min(1, Math.max(0.03, o.h));
  const c = { ...o, w, h, x: Math.min(1 - w, Math.max(0, o.x)), y: Math.min(1 - h, Math.max(0, o.y)), end: Math.max(o.start + 0.1, o.end) };
  return c.kind === "text" ? { ...c, text: c.text.slice(0, OVERLAY_TEXT_MAX) } : c;
}

export const addTrack = (t: AddedTrack) => (p: EditProject): EditProject => ({ ...p, audio: { ...p.audio, tracks: [...p.audio.tracks, t] } });

export const updateTrack = (id: string, patch: Partial<AddedTrack>) => (p: EditProject): EditProject => ({
  ...p,
  audio: { ...p.audio, tracks: p.audio.tracks.map((t) => (t.id === id ? { ...t, ...patch, start: Math.max(0, patch.start ?? t.start) } : t)) },
});

export const deleteTrack = (id: string) => (p: EditProject): EditProject => ({ ...p, audio: { ...p.audio, tracks: p.audio.tracks.filter((t) => t.id !== id) } });

/** The original sound's switch and shift. */
export const setOriginal = (patch: Partial<EditProject["audio"]["original"]>) => (p: EditProject): EditProject => ({ ...p, audio: { ...p.audio, original: { ...p.audio.original, ...patch } } });

/** A new track for an imported file: all of it, from `start`. */
export function newTrack(assetId: string, name: string, start: number, fileDuration: number, kind: "music" | "voice"): AddedTrack {
  return { id: newId(), assetId, name, start, trimIn: 0, length: fileDuration, volumeDb: kind === "music" ? -12 : 0, fadeIn: kind === "music" ? 1 : 0, fadeOut: kind === "music" ? 2 : 0, loop: false, duck: kind === "music", voice: kind === "voice" };
}

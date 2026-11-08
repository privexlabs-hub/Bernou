/**
 * The Original timeline with removed parts closed up: a position on it is the
 * recording's own time minus everything removed before it. Each removed part
 * becomes a seam, so the timeline reads like the final video while times stay
 * the recording's own (for the selection fields, the playhead and the edits).
 * Pure.
 */
import type { TimeRange } from "@/db/dexie";
import { normalizeRanges } from "./timeline";
import { ticks, type ViewWindow } from "./viewWindow";

export interface Collapse {
  /** The removed parts, merged and sorted, in the recording's time. */
  cuts: TimeRange[];
  /** The timeline's length: the recording's, less what was removed. */
  span: number;
}

/** With `off`, nothing is closed up: the timeline is the recording's own time. */
export function collapse(cuts: TimeRange[], duration: number, off = false): Collapse {
  const c = off ? [] : normalizeRanges(cuts, duration);
  return { cuts: c, span: duration - c.reduce((n, r) => n + r.end - r.start, 0) };
}

/** Recording time → timeline position. Anything inside a removed part is at its seam. */
export function toDisplay(c: Collapse, t: number): number {
  let d = t;
  for (const r of c.cuts) {
    if (r.start >= t) break;
    d -= Math.min(t, r.end) - r.start;
  }
  return d;
}

/** Timeline position → recording time. A seam is the moment just after its removed part. */
export function fromDisplay(c: Collapse, d: number): number {
  let t = d;
  for (const r of c.cuts) {
    if (r.start > t) break;
    t += r.end - r.start;
  }
  return t;
}

/** Each removed part, with where its seam is on the timeline. */
export const seams = (c: Collapse) => c.cuts.map((cut) => ({ cut, at: toDisplay(c, cut.start) }));

/** Whether recording time `t` is inside a removed part (its end belongs to what follows). */
export const isRemoved = (c: Collapse, t: number) => c.cuts.some((r) => t >= r.start && t < r.end);

/**
 * Ruler marks for a window of the timeline, labelled with the recording's own
 * time: each kept stretch gets its own marks, so a label jumps at a seam, as
 * the time does.
 */
export function collapsedTicks(c: Collapse, w: ViewWindow, widthPx: number, duration: number): { d: number; label: string }[] {
  const pxPerS = widthPx / (w.end - w.start);
  const out: { d: number; label: string }[] = [];
  let from = 0;
  for (const piece of [...c.cuts, { start: duration, end: duration }]) {
    const keep = { start: from, end: piece.start };
    from = piece.end;
    if (keep.end <= keep.start) continue;
    const d0 = toDisplay(c, keep.start);
    // The visible part of this kept stretch, in the recording's time.
    const a = keep.start + Math.max(0, w.start - d0);
    const b = Math.min(keep.end, keep.start + (w.end - d0));
    if (b <= a) continue;
    // The same scale as the whole window, so every stretch gets the same step.
    for (const tk of ticks({ start: a, end: b }, (b - a) * pxPerS)) if (tk.t >= keep.start && tk.t <= keep.end) out.push({ d: d0 + (tk.t - keep.start), label: tk.label });
  }
  return out;
}

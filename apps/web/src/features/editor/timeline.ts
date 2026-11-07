/**
 * The editor's timeline: which parts of the original are kept, and how the
 * original's time maps onto the exported video's. Pure.
 *
 * Every edit stores times in the ORIGINAL recording's seconds, so changing one
 * cut never moves another. Only this module knows about the output timeline.
 */

export interface Range {
  start: number;
  end: number;
}

export interface TimelineInput {
  /** The original's length, in seconds. */
  duration: number;
  trim: Range;
  /** Sections removed, in the original's time. */
  cuts: Range[];
  /** Crossfade across each join instead of a hard cut. */
  smoothJoins: boolean;
}

/** Length of a smooth join, at most. */
export const CROSSFADE_S = 0.5;

export interface Segment extends Range {
  /** Where this segment starts in the output. */
  outStart: number;
}

export interface Layout {
  segments: Segment[];
  /** Between segment i and i+1: how long they overlap in the output. */
  joins: { crossfade: number }[];
  /** The output's length, in seconds. */
  duration: number;
}

/** Sorted, clamped to [0, duration], overlapping or touching ranges merged, empty ones dropped. */
export function normalizeRanges(ranges: Range[], duration: number): Range[] {
  const clamped = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(duration, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of clamped) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** The parts of the original that are kept: inside the trim, outside every cut. */
export function keptSegments(input: TimelineInput): Range[] {
  const { duration } = input;
  const valid = input.trim.end > input.trim.start;
  const trim = valid ? { start: Math.max(0, input.trim.start), end: Math.min(duration, input.trim.end) } : { start: 0, end: duration };
  if (trim.end <= trim.start) return [];
  const kept: Range[] = [];
  let at = trim.start;
  for (const cut of normalizeRanges(input.cuts, duration)) {
    if (cut.end <= at) continue;
    if (cut.start >= trim.end) break;
    if (cut.start > at) kept.push({ start: at, end: cut.start });
    at = Math.max(at, cut.end);
  }
  if (at < trim.end) kept.push({ start: at, end: trim.end });
  return kept;
}

export function layout(input: TimelineInput): Layout {
  const kept = keptSegments(input);
  const segments: Segment[] = [];
  const joins: { crossfade: number }[] = [];
  let out = 0;
  kept.forEach((r, i) => {
    if (i > 0) {
      const prev = kept[i - 1]!;
      const crossfade = input.smoothJoins ? Math.min(CROSSFADE_S, (prev.end - prev.start) / 2, (r.end - r.start) / 2) : 0;
      joins.push({ crossfade });
      out -= crossfade;
    }
    segments.push({ ...r, outStart: out });
    out += r.end - r.start;
  });
  return { segments, joins, duration: out };
}

/** Where an original time lands in the output, or null if it was removed. */
export function toOutput(l: Layout, t: number): number | null {
  for (const s of l.segments) if (t >= s.start && t < s.end) return s.outStart + (t - s.start);
  return null;
}

/**
 * What plays at an output time: one original time, or two inside a smooth
 * join, each with its weight. Empty outside the output.
 */
export function sourcesAt(l: Layout, tOut: number): { t: number; weight: number }[] {
  if (tOut < 0 || tOut >= l.duration) return [];
  const hits: { t: number; weight: number; index: number }[] = [];
  l.segments.forEach((s, i) => {
    const local = tOut - s.outStart;
    if (local >= 0 && local < s.end - s.start) hits.push({ t: s.start + local, weight: 1, index: i });
  });
  if (hits.length === 2) {
    // The later segment fades in across its join with the earlier one.
    const later = hits[1]!;
    const fade = l.joins[later.index - 1]!.crossfade;
    const w = fade > 0 ? (tOut - l.segments[later.index]!.outStart) / fade : 1;
    hits[0]!.weight = 1 - w;
    later.weight = w;
  }
  return hits.map(({ t, weight }) => ({ t, weight }));
}

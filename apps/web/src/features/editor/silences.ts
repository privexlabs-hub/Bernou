/** Finding silent stretches in a recording's sound. Pure. */
import type { TimeRange } from "@/db/dexie";

/** Levels are measured over windows this long. */
export const WINDOW_S = 0.01;

/** The RMS level of each 10 ms window: measured once per decode, then scanned as often as settings change. */
export function windowLevels(samples: Float32Array, rate: number): Float32Array {
  const n = Math.max(1, Math.round(WINDOW_S * rate));
  const out = new Float32Array(Math.ceil(samples.length / n));
  for (let w = 0; w < out.length; w++) {
    let e = 0;
    const end = Math.min(samples.length, (w + 1) * n);
    for (let i = w * n; i < end; i++) e += samples[i]! * samples[i]!;
    out[w] = Math.sqrt(e / Math.max(1, end - w * n));
  }
  return out;
}

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

export interface SilenceOptions {
  thresholdDb: number;
  minDuration: number;
  keep: number;
}

/**
 * Stretches quieter than the threshold for at least `minDuration`, shrunk by
 * `keep` at each end so a natural pause remains. In the SOUND's own time.
 * `muted` stretches (sound time) count as silent: deleted sound is a gap too.
 */
export function findSilencesInLevels(levels: Float32Array, totalSeconds: number, o: SilenceOptions, muted: TimeRange[] = []): TimeRange[] {
  const limit = 10 ** (o.thresholdDb / 20);
  const quiet = (w: number) => levels[w]! < limit || muted.some((m) => w * WINDOW_S >= m.start && (w + 1) * WINDOW_S <= m.end + 1e-9);
  const out: TimeRange[] = [];
  let from = -1;
  const close = (endIndex: number) => {
    const start = from * WINDOW_S;
    const end = Math.min(totalSeconds, endIndex * WINDOW_S);
    // The ends of the recording need no pause kept on their outer side.
    const a = start <= 0 ? 0 : start + o.keep;
    const b = end >= totalSeconds ? totalSeconds : end - o.keep;
    if (end - start >= o.minDuration && b - a >= WINDOW_S - 1e-9) out.push({ start: +a.toFixed(6), end: +b.toFixed(6) });
  };
  for (let w = 0; w < levels.length; w++) {
    if (quiet(w)) {
      if (from < 0) from = w;
    } else if (from >= 0) {
      close(w);
      from = -1;
    }
  }
  if (from >= 0) close(levels.length);
  return out;
}

/** As `findSilencesInLevels`, from samples, and in picture time: `offset` is the sound's shift (sound time + offset). */
export function findSilences(samples: Float32Array, rate: number, o: SilenceOptions & { offset?: number }): TimeRange[] {
  const off = o.offset ?? 0;
  return findSilencesInLevels(windowLevels(samples, rate), samples.length / rate, o).map((s) => ({ start: +(s.start + off).toFixed(6), end: +(s.end + off).toFixed(6) }));
}

/** Midway, in dB, between the quiet 10th and loud 90th percentile of the windows, clamped to −55…−25 dBFS. */
export function suggestThresholdFromLevels(levels: Float32Array): number {
  const db = Array.from(levels, toDb).sort((a, b) => a - b);
  if (db.length === 0) return -40;
  const q = (p: number) => db[Math.min(db.length - 1, Math.floor(p * db.length))]!;
  return Math.round(Math.min(-25, Math.max(-55, (q(0.1) + q(0.9)) / 2)));
}

export const suggestThreshold = (samples: Float32Array, rate: number) => suggestThresholdFromLevels(windowLevels(samples, rate));

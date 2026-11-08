/** Finding silent stretches in a recording's sound. Pure. */
import type { TimeRange } from "@/db/dexie";

const WINDOW_S = 0.01;

function windowLevels(samples: Float32Array, rate: number): Float32Array {
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

/**
 * Stretches quieter than `thresholdDb` for at least `minDuration`, shrunk by
 * `keep` at each end so a natural pause remains. In picture time: `offset` is
 * how far the sound is shifted against the picture (sound time + offset).
 */
export function findSilences(samples: Float32Array, rate: number, o: { thresholdDb: number; minDuration: number; keep: number; offset?: number }): TimeRange[] {
  const levels = windowLevels(samples, rate);
  const limit = 10 ** (o.thresholdDb / 20);
  const total = samples.length / rate;
  const out: TimeRange[] = [];
  let from = -1;
  const close = (endIndex: number) => {
    const start = from * WINDOW_S;
    const end = Math.min(total, endIndex * WINDOW_S);
    // The ends of the recording need no pause kept on their outer side.
    const a = start <= 0 ? 0 : start + o.keep;
    const b = end >= total ? total : end - o.keep;
    if (end - start >= o.minDuration && b - a >= WINDOW_S - 1e-9) out.push({ start: +(a + (o.offset ?? 0)).toFixed(6), end: +(b + (o.offset ?? 0)).toFixed(6) });
  };
  for (let w = 0; w < levels.length; w++) {
    if (levels[w]! < limit) {
      if (from < 0) from = w;
    } else if (from >= 0) {
      close(w);
      from = -1;
    }
  }
  if (from >= 0) close(levels.length);
  return out;
}

/** Midway, in dB, between the quiet 10th and loud 90th percentile of the sound's 10 ms windows. */
export function suggestThreshold(samples: Float32Array, rate: number): number {
  const levels = Array.from(windowLevels(samples, rate), toDb).sort((a, b) => a - b);
  if (levels.length === 0) return -40;
  const q = (p: number) => levels[Math.min(levels.length - 1, Math.floor(p * levels.length))]!;
  return Math.round(Math.min(-25, Math.max(-55, (q(0.1) + q(0.9)) / 2)));
}

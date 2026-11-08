/**
 * Music that dips while someone speaks. One envelope, computed once on the
 * page, drives both the preview (as gain automation) and the export (by
 * interpolation), so they match. Pure.
 */

import type { TimeRange } from "@/db/dexie";
import { sourcesAt, type Layout } from "./timeline";

/** Envelope values per second. */
export const ENVELOPE_RATE = 100;
const ATTACK_S = 0.05;
const RELEASE_S = 0.4;
/** Less spread than this between the quiet and loud parts, and there's no speech to dip for: just noise. */
const MIN_SPREAD_DB = 6;

/**
 * Where speech starts in these levels: halfway, in dB, between the quiet 10th
 * and loud 90th percentile, so a noisy (outdoor) recording's noise isn't taken
 * for speech. Null when there's no real difference: nothing to dip for.
 */
function voiceThreshold(voiceRms: Float32Array): number | null {
  const db = Array.from(voiceRms, (x) => 20 * Math.log10(Math.max(x, 1e-9))).sort((a, b) => a - b);
  if (db.length === 0) return null;
  const q = (p: number) => db[Math.min(db.length - 1, Math.floor(p * db.length))]!;
  const quiet = q(0.1);
  const loud = q(0.9);
  if (loud - quiet < MIN_SPREAD_DB) return null;
  return 10 ** ((quiet + loud) / 2 / 20);
}

/** Gain per 10 ms step: `depthDb` down while someone speaks, smoothed. */
export function duckingEnvelope(voiceRms: Float32Array, depthDb: number): Float32Array {
  const depth = 10 ** (depthDb / 20);
  const limit = voiceThreshold(voiceRms) ?? Infinity;
  const step = 1 / ENVELOPE_RATE;
  const down = 1 - Math.exp(-step / ATTACK_S);
  const up = 1 - Math.exp(-step / RELEASE_S);
  const out = new Float32Array(voiceRms.length);
  let g = 1;
  for (let i = 0; i < voiceRms.length; i++) {
    const target = voiceRms[i]! > limit ? depth : 1;
    g += (target - g) * (target < g ? down : up);
    out[i] = g;
  }
  return out;
}

/** The envelope's value at time t, interpolated. */
export function envelopeAt(env: Float32Array, t: number): number {
  if (env.length === 0) return 1;
  const x = t * ENVELOPE_RATE;
  const i = Math.floor(x);
  if (i < 0) return env[0]!;
  if (i >= env.length - 1) return env[env.length - 1]!;
  return env[i]! + (env[i + 1]! - env[i]!) * (x - i);
}

/** A voice track's audio, positioned on the output timeline as the mixer plays it. */
export interface VoiceTrack {
  samples: Float32Array;
  rate: number;
  start: number;
  trimIn: number;
  length: number;
  loop: boolean;
}

/**
 * How loud speech is in each 10 ms of the edited output: the recording's sound
 * as it lands there (cuts, its shift, mutes; before noise removal and volume),
 * plus any added track marked as a voice. Mono.
 */
export function voiceLevels(o: { layout: Layout; original: { samples: Float32Array; rate: number; offset: number; mutes: TimeRange[] } | null; voiceTracks: VoiceTrack[] }): Float32Array {
  const n = Math.ceil(o.layout.duration * ENVELOPE_RATE);
  const out = new Float32Array(n);
  const step = 1 / ENVELOPE_RATE;
  const rms = (samples: Float32Array, rate: number, from: number) => {
    const a = Math.max(0, Math.floor(from * rate));
    const b = Math.min(samples.length, Math.floor((from + step) * rate));
    let e = 0;
    for (let i = a; i < b; i++) e += samples[i]! * samples[i]!;
    return b > a ? e / (b - a) : 0;
  };
  for (let k = 0; k < n; k++) {
    const t = k * step;
    let energy = 0;
    if (o.original) {
      const { samples, rate, offset, mutes } = o.original;
      for (const s of sourcesAt(o.layout, t)) {
        if (mutes.some((m) => s.t >= m.start && s.t < m.end)) continue;
        energy += rms(samples, rate, s.t - offset) * s.weight * s.weight;
      }
    }
    for (const v of o.voiceTracks) {
      const end = v.loop ? o.layout.duration : v.start + v.length;
      if (t < v.start || t >= end || v.length <= 0) continue;
      energy += rms(v.samples, v.rate, v.trimIn + ((t - v.start) % v.length));
    }
    out[k] = Math.sqrt(energy);
  }
  return out;
}

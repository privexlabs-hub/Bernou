import { describe, expect, it } from "vitest";
import { findSilences, suggestThreshold } from "@/features/editor/silences";

const RATE = 1000;
/** Tone where `loud(t)`, silence elsewhere, `seconds` long. */
function signal(seconds: number, loud: (t: number) => boolean, noise = 0) {
  return Float32Array.from({ length: seconds * RATE }, (_, i) => (loud(i / RATE) ? 0.5 * Math.sin(i * 0.9) : 0) + (noise ? noise * Math.sin(i * 2.7) : 0));
}
const opts = { thresholdDb: -40, minDuration: 0.5, keep: 0 };

describe("silences", () => {
  it("finds a silent stretch with exact edges, to the 10 ms window", () => {
    const s = findSilences(signal(6, (t) => t < 2 || t >= 4), RATE, opts);
    expect(s).toHaveLength(1);
    expect(s[0]!.start).toBeCloseTo(2, 2);
    expect(s[0]!.end).toBeCloseTo(4, 2);
  });

  it("keeps a natural pause at each end", () => {
    const [s] = findSilences(signal(6, (t) => t < 2 || t >= 4), RATE, { ...opts, keep: 0.2 });
    expect(s!.start).toBeCloseTo(2.2, 2);
    expect(s!.end).toBeCloseTo(3.8, 2);
  });

  it("ignores gaps shorter than the minimum", () => {
    expect(findSilences(signal(6, (t) => t < 2 || t >= 2.3), RATE, opts)).toEqual([]);
  });

  it("all silent is one stretch; never silent is none", () => {
    expect(findSilences(signal(3, () => false), RATE, opts)).toEqual([{ start: 0, end: 3 }]);
    expect(findSilences(signal(3, () => true), RATE, opts)).toEqual([]);
  });

  it("a gap too short once the pauses are kept is left alone", () => {
    expect(findSilences(signal(6, (t) => t < 2 || t >= 2.6), RATE, { ...opts, keep: 0.3 })).toEqual([]);
  });

  it("the sound's offset against the picture moves the results to picture time", () => {
    const [s] = findSilences(signal(6, (t) => t < 2 || t >= 4), RATE, { ...opts, offset: 0.25 });
    expect(s!.start).toBeCloseTo(2.25, 2);
  });

  it("suggests a threshold between the noise floor and the speech", () => {
    const x = signal(10, (t) => Math.floor(t) % 2 === 0, 0.003);
    const db = suggestThreshold(x, RATE);
    expect(db).toBeGreaterThan(-55);
    expect(db).toBeLessThan(-12);
    expect(findSilences(x, RATE, { thresholdDb: db, minDuration: 0.5, keep: 0 })).toHaveLength(5);
  });
});

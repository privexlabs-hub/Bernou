import { describe, expect, it } from "vitest";
import { duckingEnvelope, ENVELOPE_RATE } from "@/features/editor/ducking";
import { TrackMixer, type MixTrack } from "@/features/editor/mixTracks";

const RATE = 1000;
const ones = (s: number) => new Float32Array(s * RATE).fill(0.5);
const track = (o: Partial<MixTrack> = {}): MixTrack => ({ planes: [ones(2)], start: 1, trimIn: 0, length: 2, volumeDb: 0, fadeIn: 0, fadeOut: 0, loop: false, duck: false, ...o });

/** Mixes onto silence of `seconds`, in pieces of `piece` samples, and returns channel 0. */
function mix(tracks: MixTrack[], seconds: number, envelope: Float32Array | null = null, piece = 337) {
  const m = new TrackMixer({ sampleRate: RATE, tracks, envelope, outputDuration: seconds });
  const out: number[] = [];
  for (let at = 0; at < seconds * RATE; at += piece) {
    const p = [new Float32Array(Math.min(piece, seconds * RATE - at))];
    m.mix(p, at);
    out.push(...p[0]!);
  }
  return out;
}
const at = (o: number[], t: number) => o[Math.round(t * RATE)]!;

describe("mixing added tracks", () => {
  it("plays from its start, for its length", () => {
    const o = mix([track()], 5);
    expect(at(o, 0.5)).toBe(0);
    expect(at(o, 1.5)).toBeCloseTo(0.5, 6);
    expect(at(o, 3.5)).toBe(0);
  });

  it("trim-in starts partway into the file", () => {
    const planes = [Float32Array.from({ length: 3 * RATE }, (_, i) => (i < RATE ? 0.1 : 0.7))];
    const o = mix([track({ planes, trimIn: 1, length: 1 })], 4);
    expect(at(o, 1.5)).toBeCloseTo(0.7, 6);
    expect(at(o, 2.5)).toBe(0);
  });

  it("volume in dB", () => {
    expect(at(mix([track({ volumeDb: -6 })], 4), 1.5)).toBeCloseTo(0.5 * 10 ** (-6 / 20), 5);
  });

  it("loop fills to the end of the video", () => {
    const o = mix([track({ loop: true, length: 0.5 })], 6);
    expect(at(o, 5.9)).toBeCloseTo(0.5, 6);
    expect(at(o, 0.9)).toBe(0);
  });

  it("fades in and out", () => {
    const o = mix([track({ fadeIn: 1, fadeOut: 0.5 })], 4);
    expect(at(o, 1.5)).toBeCloseTo(0.25, 2);
    expect(at(o, 2.75)).toBeCloseTo(0.25, 2);
    expect(at(o, 2.2)).toBeCloseTo(0.5, 6);
  });

  it("adds to what's there, and clamps once at full scale", () => {
    const m = new TrackMixer({ sampleRate: RATE, tracks: [track({ planes: [new Float32Array(2 * RATE).fill(0.9)] })], envelope: null, outputDuration: 4 });
    const p = [new Float32Array(4 * RATE).fill(0.3)];
    m.mix(p, 0);
    expect(p[0]![1500]).toBe(1);
    expect(p[0]![500]).toBeCloseTo(0.3, 6);
  });

  it("a mono track goes to both channels", () => {
    const m = new TrackMixer({ sampleRate: RATE, tracks: [track()], envelope: null, outputDuration: 4 });
    const p = [new Float32Array(4 * RATE), new Float32Array(4 * RATE)];
    m.mix(p, 0);
    expect(p[1]![1500]).toBeCloseTo(0.5, 6);
  });

  it("ducking follows the envelope, interpolated, only on tracks set to duck", () => {
    const env = new Float32Array(5 * ENVELOPE_RATE).fill(1);
    env.fill(0.25, 1.5 * ENVELOPE_RATE, 5 * ENVELOPE_RATE);
    const ducked = mix([track({ duck: true })], 5, env);
    const plain = mix([track()], 5, env);
    expect(at(ducked, 1.2)).toBeCloseTo(0.5, 6);
    expect(at(ducked, 2.5)).toBeCloseTo(0.125, 6);
    expect(at(plain, 2.5)).toBeCloseTo(0.5, 6);
  });
});

describe("ducking envelope", () => {
  // Voice from 1 s to 3 s, then quiet: in 10 ms steps.
  const voiceRms = Float32Array.from({ length: 6 * ENVELOPE_RATE }, (_, i) => (i >= 100 && i < 300 ? 0.2 : 0.001));

  it("dips by the depth while someone speaks, and comes back up after", () => {
    const g = duckingEnvelope(voiceRms, -12);
    const depth = 10 ** (-12 / 20);
    expect(g[50]).toBeCloseTo(1, 3); // before speech
    expect(g[250]).toBeCloseTo(depth, 2); // well into speech
    expect(g[550]).toBeGreaterThan(0.95); // long after
  });

  it("goes down fast (about 50 ms) and comes up slowly (about 400 ms)", () => {
    const g = duckingEnvelope(voiceRms, -12);
    const depth = 10 ** (-12 / 20);
    const half = (1 + depth) / 2;
    const down = Array.from(g).findIndex((v, i) => i >= 100 && v <= half) - 100;
    const up = Array.from(g).findIndex((v, i) => i >= 300 && v >= half) - 300;
    expect(down).toBeLessThanOrEqual(6); // tens of ms
    expect(up).toBeGreaterThan(down * 3);
  });

  it("over steady background noise (outdoors), dips only while someone speaks", () => {
    // Noise at about -29 dB all through, speech at about -19 dB from 1 s to 3 s.
    const noisy = Float32Array.from({ length: 6 * ENVELOPE_RATE }, (_, i) => (i >= 100 && i < 300 ? 0.11 : 0.035));
    const g = duckingEnvelope(noisy, -12);
    expect(g[50]).toBeCloseTo(1, 3);
    expect(g[250]).toBeCloseTo(10 ** (-12 / 20), 2);
    expect(g[550]).toBeGreaterThan(0.95);
  });

  it("noise alone, however loud, isn't speech: no dip", () => {
    const g = duckingEnvelope(new Float32Array(600).fill(0.035), -12);
    expect(Math.min(...g)).toBeCloseTo(1, 6);
  });

  it("no voice, no dip", () => {
    const g = duckingEnvelope(new Float32Array(300).fill(0.001), -12);
    expect(Math.min(...g)).toBeCloseTo(1, 6);
  });
});

describe("voice levels for the dip", () => {
  it("follows the recording's sound through cuts, its shift and mutes, plus any voice track", async () => {
    const { voiceLevels } = await import("@/features/editor/ducking");
    const { layout } = await import("@/features/editor/timeline");
    const rate = 1000;
    // Speech from 1 s to 2 s and from 6 s to 7 s in the original sound.
    const original = Float32Array.from({ length: 10 * rate }, (_, i) => ((i >= 1000 && i < 2000) || (i >= 6000 && i < 7000) ? 0.3 : 0));
    const l = layout({ duration: 10, trim: { start: 0, end: 10 }, cuts: [{ start: 3, end: 5 }], smoothJoins: false });
    const levels = voiceLevels({ layout: l, original: { samples: original, rate, offset: 0.5, mutes: [{ start: 6.5, end: 7.5 }] }, voiceTracks: [] });
    const at = (t: number) => levels[Math.round(t * ENVELOPE_RATE)]!;
    expect(levels.length).toBe(Math.ceil(l.duration * ENVELOPE_RATE));
    expect(at(1.2)).toBe(0); // shifted 0.5 s later: speech starts at 1.5
    expect(at(1.7)).toBeGreaterThan(0.2);
    // Original 6.5..7.5 shows speech 6..7 shifted, but it's muted; output time is original - 2 (the cut).
    expect(at(4.6)).toBe(0);
    const withVoice = voiceLevels({ layout: l, original: null, voiceTracks: [{ samples: new Float32Array(rate).fill(0.4), rate, start: 2, trimIn: 0, length: 1, loop: false }] });
    expect(withVoice[Math.round(1.5 * ENVELOPE_RATE)]).toBe(0);
    expect(withVoice[Math.round(2.5 * ENVELOPE_RATE)]).toBeGreaterThan(0.3);
  });
});

describe("mixing a slice of the output (a join preview)", () => {
  it("places tracks by the slice's start, and loops to the full video's end", () => {
    const m = new TrackMixer({ sampleRate: RATE, tracks: [track({ start: 3, length: 0.5, loop: true })], envelope: null, outputDuration: 10, timeOffset: 2 });
    const p = [new Float32Array(3 * RATE)]; // output 2..5
    m.mix(p, 0);
    expect(p[0]![500]).toBe(0); // output 2.5: before the track
    expect(p[0]![1500]).toBeCloseTo(0.5, 6); // output 3.5
    expect(p[0]![2900]).toBeCloseTo(0.5, 6); // output 4.9: still looping
  });
});

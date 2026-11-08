import { describe, expect, it } from "vitest";
import { AudioRenderer, EDGE_FADE_S, type Denoiser } from "@/features/editor/audioRender";
import { layout } from "@/features/editor/timeline";
import { newEditProject } from "@/features/editor/project";
import type { EditProject } from "@/db/dexie";

const RATE = 1000; // small and round, so sample counts are easy to reason about
const rec = { id: "r", durationMs: 10_000 };

/** Feeds a constant signal (value 0.5) for every kept segment, in pieces, and collects the output. */
function render(project: EditProject, opts: { denoiser?: () => Denoiser; value?: (t: number) => number; piece?: number } = {}) {
  const l = layout({ duration: 10, trim: project.trim, cuts: project.cuts, smoothJoins: project.smoothJoins });
  const out: number[] = [];
  const stamps: number[] = [];
  const r = new AudioRenderer({ sampleRate: RATE, channels: 1, layout: l, project, denoiser: opts.denoiser, onOutput: (planes, ts) => { stamps.push(ts); out.push(...planes[0]!); } });
  const value = opts.value ?? (() => 0.5);
  const piece = opts.piece ?? 137; // deliberately uneven
  l.segments.forEach((seg, i) => {
    const n = Math.round((seg.end - seg.start) * RATE);
    for (let at = 0; at < n; at += piece) {
      const len = Math.min(piece, n - at);
      const plane = new Float32Array(len).map((_, j) => value(seg.start + (at + j) / RATE));
      r.push(i, seg.start + at / RATE, [plane]);
    }
  });
  r.finish();
  return { out, stamps, l };
}

const at = (out: number[], t: number) => out[Math.round(t * RATE)]!;

describe("audio render", () => {
  it("with nothing changed, the output is the input, the full length", () => {
    const { out } = render(newEditProject(rec));
    expect(out).toHaveLength(10 * RATE);
    expect(at(out, 5)).toBeCloseTo(0.5, 6);
  });

  it("output timestamps run on with no gaps or overlaps", () => {
    const { stamps, out } = render({ ...newEditProject(rec), cuts: [{ start: 2, end: 4 }] });
    expect(stamps[0]).toBe(0);
    expect(out).toHaveLength(8 * RATE);
  });

  it("a cut removes its time, and both sides of the join fade briefly so there's no click", () => {
    const { out } = render({ ...newEditProject(rec), cuts: [{ start: 2, end: 4 }] }, { value: (t) => (t < 2 ? 0.5 : 0.25) });
    expect(out).toHaveLength(8 * RATE);
    expect(at(out, 1)).toBeCloseTo(0.5, 6);
    expect(at(out, 3)).toBeCloseTo(0.25, 6); // original t=5
    expect(Math.abs(at(out, 2 - 0.0005))).toBeLessThan(0.1); // fading out at the join
    expect(Math.abs(at(out, 2))).toBeLessThan(0.1); // fading in after it
    expect(at(out, 2 + EDGE_FADE_S + 0.002)).toBeCloseTo(0.25, 6);
  });

  it("the cut fade is 3 ms: short enough not to be heard around a tiny cut", () => {
    expect(EDGE_FADE_S).toBe(0.003);
  });

  it("no sample jumps by more than a 3-sample ramp allows at a hard join", () => {
    const { out } = render({ ...newEditProject(rec), cuts: [{ start: 2, end: 4 }] }, { value: (t) => (t < 2 ? 0.9 : -0.9) });
    let worst = 0;
    for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i]! - out[i - 1]!));
    // A fixed number, not derived from EDGE_FADE_S: 3 ms at this rate is 3 samples, so 0.9 / 3.
    expect(worst).toBeLessThanOrEqual(0.3 + 1e-6);
  });

  it("without its clamp, loud sound passes through for the mixer to clamp once", () => {
    const l = layout({ duration: 10, trim: { start: 0, end: 10 }, cuts: [], smoothJoins: false });
    const out: number[] = [];
    const r = new AudioRenderer({ sampleRate: RATE, channels: 1, layout: l, project: { ...newEditProject(rec), audio: { ...newEditProject(rec).audio, volumeDb: 12 } }, clamp: false, onOutput: (p) => out.push(...p[0]!) });
    r.push(0, 0, [new Float32Array(10 * RATE).fill(0.5)]);
    r.finish();
    expect(out[5 * RATE]).toBeCloseTo(0.5 * 10 ** (12 / 20), 5);
  });

  it("a smooth join mixes both sides, with weights that add up to one", () => {
    const { out, l } = render({ ...newEditProject(rec), cuts: [{ start: 2, end: 4 }], smoothJoins: true }, { value: (t) => (t < 2 ? 1 : 0) });
    expect(out).toHaveLength(Math.round(l.duration * RATE));
    const join = l.segments[1]!.outStart; // the join starts here, 0.5 s before the first side ends
    expect(at(out, join + 0.25)).toBeCloseTo(0.5, 2); // halfway: half of the side that's 1
    expect(at(out, join + 0.05)).toBeGreaterThan(at(out, join + 0.45)); // fading out
  });

  it("a muted section is silent, with short ramps just outside it, and the rest unchanged", () => {
    const { out } = render({ ...newEditProject(rec), audio: { ...newEditProject(rec).audio, mutes: [{ start: 3, end: 5 }] } });
    for (let t = 3; t < 5; t += 0.05) expect(at(out, t)).toBe(0);
    // 2 ms before the mute, on an exact sample: the ramp is 2/3 of the way back up.
    expect(at(out, 3 - 0.002)).toBeCloseTo(0.5 * (0.002 / EDGE_FADE_S), 6);
    expect(at(out, 2)).toBeCloseTo(0.5, 6);
    expect(at(out, 6)).toBeCloseTo(0.5, 6);
  });

  it("volume is in dB, and nothing goes past full scale", () => {
    const minus6 = render({ ...newEditProject(rec), audio: { ...newEditProject(rec).audio, volumeDb: -6 } }).out;
    expect(at(minus6, 5)).toBeCloseTo(0.5 * 10 ** (-6 / 20), 5);
    const loud = render({ ...newEditProject(rec), audio: { ...newEditProject(rec).audio, volumeDb: 12 } }).out;
    expect(Math.max(...loud)).toBeLessThanOrEqual(1);
  });

  describe("noise removal", () => {
    /** Halves its input, two frames late: the shape of the real model's delay. */
    const halving = (): Denoiser => {
      const frameSize = 10;
      const line: number[] = new Array(20).fill(0);
      return {
        frameSize,
        delay: 20,
        process(frame) {
          for (let i = 0; i < frame.length; i++) {
            line.push(frame[i]! * 0.5);
            frame[i] = line.shift()!;
          }
        },
      };
    };
    const on = (strength: number) => ({ ...newEditProject(rec), audio: { ...newEditProject(rec).audio, denoise: { on: true, strength } } });

    it("its delay is taken back out, so the output lines up with the picture and has the same length", () => {
      const { out } = render(on(1), { denoiser: halving, value: (t) => (t >= 5 ? 0.8 : 0) });
      expect(out).toHaveLength(10 * RATE);
      expect(at(out, 5 - 0.002)).toBe(0); // not early
      expect(at(out, 5 + 0.002)).toBeCloseTo(0.4, 6); // not late
    });

    it("strength blends the denoised sound with the original, with no echo", () => {
      const { out } = render(on(0.5), { denoiser: halving, value: (t) => (t >= 5 ? 0.8 : 0) });
      expect(at(out, 5 - 0.002)).toBe(0);
      expect(at(out, 5 + 0.002)).toBeCloseTo(0.5 * 0.8 + 0.5 * 0.4, 6);
    });

    it("off means the denoiser isn't used", () => {
      let used = false;
      render(newEditProject(rec), { denoiser: () => ({ frameSize: 10, delay: 0, process: () => void (used = true) }) });
      expect(used).toBe(false);
    });
  });

  it("everything cut gives no audio", () => {
    expect(render({ ...newEditProject(rec), cuts: [{ start: 0, end: 10 }] }).out).toHaveLength(0);
  });
});

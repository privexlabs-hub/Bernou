import { describe, expect, it } from "vitest";
import { blankPicture, unblankPicture } from "@/features/editor/edits";
import { newEditProject, normalizeProject } from "@/features/editor/project";
import { isBlank } from "@/features/editor/render";
import { findSilences, findSilencesInLevels, windowLevels, WINDOW_S } from "@/features/editor/silences";

const rec = { id: "r", durationMs: 10_000 };

describe("picture-only cuts", () => {
  it("old projects open with none", () => {
    const { blanks: _gone, ...old } = newEditProject(rec);
    expect(normalizeProject(old as never).blanks).toEqual([]);
  });

  it("merge and split like mutes", () => {
    let p = blankPicture({ start: 2, end: 4 }, 10)(newEditProject(rec));
    p = blankPicture({ start: 3, end: 5 }, 10)(p);
    expect(p.blanks).toEqual([{ start: 2, end: 5 }]);
    p = unblankPicture({ start: 3, end: 4 }, 10)(p);
    expect(p.blanks).toEqual([{ start: 2, end: 3 }, { start: 4, end: 5 }]);
  });

  it("a frame is black inside one, from its start up to its end", () => {
    const b = [{ start: 2, end: 3 }];
    expect(isBlank(b, 1.999)).toBe(false);
    expect(isBlank(b, 2)).toBe(true);
    expect(isBlank(b, 2.999)).toBe(true);
    expect(isBlank(b, 3)).toBe(false);
  });
});

describe("silences from levels measured once", () => {
  const RATE = 1000;
  const sig = Float32Array.from({ length: 6 * RATE }, (_, i) => (i < 2 * RATE || i >= 4 * RATE ? 0.5 * Math.sin(i * 0.9) : 0));
  const opts = { thresholdDb: -40, minDuration: 0.5, keep: 0 };

  it("give the same result as from the samples", () => {
    const levels = windowLevels(sig, RATE);
    expect(findSilencesInLevels(levels, 6, opts)).toEqual(findSilences(sig, RATE, opts));
  });

  it("are in the sound's own time (no shift)", () => {
    const [s] = findSilencesInLevels(windowLevels(sig, RATE), 6, opts);
    expect(s!.start).toBeCloseTo(2, 2);
  });

  it("count sound you've deleted (muted) as silent", () => {
    const levels = windowLevels(sig, RATE);
    // Muted from 0.5 to 1.5 in sound time: now a silence there too.
    const found = findSilencesInLevels(levels, 6, opts, [{ start: 0.5, end: 1.5 }]);
    expect(found).toHaveLength(2);
    expect(found[0]!.start).toBeCloseTo(0.5, 2);
    expect(found[0]!.end).toBeCloseTo(1.5, 2);
    expect(WINDOW_S).toBe(0.01);
  });
});

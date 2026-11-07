import { describe, expect, it } from "vitest";
import { CROSSFADE_S, keptSegments, layout, normalizeRanges, sourcesAt, toOutput } from "@/features/editor/timeline";

const base = { duration: 10, trim: { start: 0, end: 10 }, cuts: [], smoothJoins: false };

describe("ranges", () => {
  it("sorts, clamps to the recording, and merges overlapping or touching ranges", () => {
    expect(normalizeRanges([{ start: 6, end: 8 }, { start: -1, end: 2 }, { start: 1.5, end: 3 }, { start: 8, end: 12 }], 10)).toEqual([
      { start: 0, end: 3 },
      { start: 6, end: 10 },
    ]);
  });

  it("drops empty and reversed ranges", () => {
    expect(normalizeRanges([{ start: 4, end: 4 }, { start: 5, end: 3 }], 10)).toEqual([]);
  });
});

describe("kept segments", () => {
  it("everything, with nothing cut", () => {
    expect(keptSegments(base)).toEqual([{ start: 0, end: 10 }]);
  });

  it("a cut in the middle leaves two segments", () => {
    expect(keptSegments({ ...base, cuts: [{ start: 2, end: 4 }] })).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 },
    ]);
  });

  it("cuts at either end, and the trim, all just shorten it", () => {
    expect(keptSegments({ ...base, trim: { start: 1, end: 9 }, cuts: [{ start: 0, end: 2 }, { start: 8.5, end: 10 }] })).toEqual([{ start: 2, end: 8.5 }]);
  });

  it("overlapping cuts behave as one", () => {
    expect(keptSegments({ ...base, cuts: [{ start: 2, end: 5 }, { start: 4, end: 6 }] })).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 10 },
    ]);
  });

  it("everything cut leaves nothing", () => {
    expect(keptSegments({ ...base, cuts: [{ start: 0, end: 10 }] })).toEqual([]);
    expect(layout({ ...base, cuts: [{ start: 0, end: 10 }] }).duration).toBe(0);
  });

  it("a reversed or out-of-range trim keeps the whole recording", () => {
    expect(keptSegments({ ...base, trim: { start: 8, end: 2 } })).toEqual([{ start: 0, end: 10 }]);
    expect(keptSegments({ ...base, trim: { start: -5, end: 50 } })).toEqual([{ start: 0, end: 10 }]);
  });
});

describe("output timeline", () => {
  it("hard cuts: the output is the kept time, and maps back exactly", () => {
    const l = layout({ ...base, cuts: [{ start: 2, end: 4 }] });
    expect(l.duration).toBe(8);
    expect(toOutput(l, 1)).toBe(1);
    expect(toOutput(l, 3)).toBeNull(); // removed
    expect(toOutput(l, 5)).toBe(3);
    expect(sourcesAt(l, 3)).toEqual([{ t: 5, weight: 1 }]);
    expect(sourcesAt(l, 1.999)).toEqual([{ t: 1.999, weight: 1 }]);
  });

  it("smooth joins overlap the two sides, shortening the output by each crossfade", () => {
    const l = layout({ ...base, cuts: [{ start: 2, end: 4 }], smoothJoins: true });
    expect(l.duration).toBeCloseTo(8 - CROSSFADE_S, 9);
    // Inside the join, both sides are present, fading across.
    const mid = sourcesAt(l, 2 - CROSSFADE_S / 2);
    expect(mid).toHaveLength(2);
    expect(mid[0]!.t).toBeCloseTo(2 - CROSSFADE_S / 2, 9); // the section before, still playing
    expect(mid[1]!.t).toBeCloseTo(4 + CROSSFADE_S / 2, 9); // the section after, already started
    expect(mid[0]!.weight + mid[1]!.weight).toBeCloseTo(1, 9);
    expect(mid[1]!.weight).toBeCloseTo(0.5, 9);
    // Outside it, one side only.
    expect(sourcesAt(l, 0.5)).toEqual([{ t: 0.5, weight: 1 }]);
    expect(sourcesAt(l, 5)).toHaveLength(1);
  });

  it("a crossfade is never longer than half of either side", () => {
    const l = layout({ ...base, cuts: [{ start: 0.6, end: 4 }], smoothJoins: true }); // first side is 0.6 s
    expect(l.joins[0]!.crossfade).toBeCloseTo(0.3, 9);
    expect(l.duration).toBeCloseTo(0.6 + 6 - 0.3, 9);
  });

  it("output time runs from 0 to the duration with no gaps, across several joins", () => {
    const l = layout({ ...base, cuts: [{ start: 2, end: 3 }, { start: 5, end: 6 }], smoothJoins: true });
    for (let t = 0; t < l.duration; t += 0.01) expect(sourcesAt(l, t).length).toBeGreaterThan(0);
    expect(sourcesAt(l, l.duration)).toEqual([]);
    expect(sourcesAt(l, -0.01)).toEqual([]);
  });

  it("toOutput is the inverse of sourcesAt outside joins", () => {
    const l = layout({ ...base, trim: { start: 0.5, end: 9.5 }, cuts: [{ start: 3, end: 4.25 }] });
    for (const t of [0.5, 1, 2.999, 4.25, 7, 9.49]) {
      const out = toOutput(l, t)!;
      expect(sourcesAt(l, out)[0]!.t).toBeCloseTo(t, 9);
    }
  });
});

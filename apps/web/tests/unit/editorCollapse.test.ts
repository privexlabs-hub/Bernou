import { describe, expect, it } from "vitest";
import { collapse, collapsedTicks, fromDisplay, isRemoved, seams, toDisplay } from "@/features/editor/collapse";

describe("the timeline with removed parts closed up", () => {
  const c = collapse([{ start: 4, end: 5 }, { start: 2, end: 3 }], 10);

  it("is shorter by what was removed, with the cuts merged and sorted", () => {
    expect(c.span).toBe(8);
    expect(c.cuts).toEqual([{ start: 2, end: 3 }, { start: 4, end: 5 }]);
    expect(collapse([{ start: 2, end: 3 }, { start: 2.5, end: 4 }], 10).span).toBe(8);
  });

  it("maps the recording's time to the timeline and back", () => {
    expect(toDisplay(c, 1)).toBe(1);
    expect(toDisplay(c, 3)).toBe(2);
    expect(toDisplay(c, 3.5)).toBe(2.5);
    expect(toDisplay(c, 6)).toBe(4);
    for (const t of [0, 1, 3, 3.5, 5, 6, 10]) expect(fromDisplay(c, toDisplay(c, t))).toBeCloseTo(t, 12);
  });

  it("puts anything removed at its seam, and a seam just after its removed part", () => {
    expect(toDisplay(c, 2.5)).toBe(2);
    expect(toDisplay(c, 4.9)).toBe(3);
    expect(fromDisplay(c, 2)).toBe(3);
    expect(fromDisplay(c, 3)).toBe(5);
    expect(seams(c)).toEqual([{ cut: { start: 2, end: 3 }, at: 2 }, { cut: { start: 4, end: 5 }, at: 3 }]);
    expect(isRemoved(c, 2)).toBe(true);
    expect(isRemoved(c, 3)).toBe(false);
  });

  it("closes nothing when switched off", () => {
    const off = collapse([{ start: 2, end: 3 }], 10, true);
    expect(off.span).toBe(10);
    expect(toDisplay(off, 2.5)).toBe(2.5);
    expect(seams(off)).toEqual([]);
  });

  it("labels the ruler with the recording's own time, jumping at a seam", () => {
    const one = collapse([{ start: 2, end: 3 }], 10);
    // 9 s on 900 px: a mark a second.
    const marks = collapsedTicks(one, { start: 0, end: 9 }, 900, 10);
    expect(marks.map((m) => m.label)).toEqual(["0:00", "0:01", "0:02", "0:03", "0:04", "0:05", "0:06", "0:07", "0:08", "0:09", "0:10"]);
    // 0:02 is where the removed part starts, 0:03 where it ends: both at the seam.
    expect(marks.find((m) => m.label === "0:02")!.d).toBe(2);
    expect(marks.find((m) => m.label === "0:03")!.d).toBe(2);
    expect(marks.find((m) => m.label === "0:05")!.d).toBe(4);
    // Only what's in view.
    expect(collapsedTicks(one, { start: 4, end: 6 }, 200, 10).map((m) => m.label)).toEqual(["0:05", "0:06", "0:07"]);
  });
});

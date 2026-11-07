import { describe, expect, it } from "vitest";
import { clampOverlay, muteSection, newText, removeSection, restoreSection, unmuteSection } from "@/features/editor/edits";
import { newEditProject } from "@/features/editor/project";

const p0 = newEditProject({ id: "r", durationMs: 10_000 });

describe("edits", () => {
  it("removing sections merges them; restoring part of one splits it", () => {
    let p = removeSection({ start: 2, end: 4 }, 10)(p0);
    p = removeSection({ start: 3, end: 6 }, 10)(p);
    expect(p.cuts).toEqual([{ start: 2, end: 6 }]);
    p = restoreSection({ start: 3, end: 4 }, 10)(p);
    expect(p.cuts).toEqual([{ start: 2, end: 3 }, { start: 4, end: 6 }]);
  });

  it("muting and unmuting work the same way", () => {
    let p = muteSection({ start: 1, end: 5 }, 10)(p0);
    p = unmuteSection({ start: 0, end: 2 }, 10)(p);
    expect(p.audio.mutes).toEqual([{ start: 2, end: 5 }]);
  });

  it("an overlay is kept inside the frame, with its text within the limit", () => {
    const o = clampOverlay({ ...newText({ start: 1, end: 2 }), x: 0.9, y: -1, w: 0.5, text: "x".repeat(500) } as never);
    expect(o.x).toBeCloseTo(0.5, 9);
    expect(o.y).toBe(0);
    expect((o as { text: string }).text).toHaveLength(200);
  });

  it("an overlay is never shorter than a tenth of a second", () => {
    expect(clampOverlay({ ...newText({ start: 5, end: 5 }) } as never).end).toBeCloseTo(5.1, 9);
  });
});

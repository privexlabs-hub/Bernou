import { describe, expect, it } from "vitest";
import { eraseAt } from "@/features/ink/eraseAt";

const pen = (points: number[]) => ({ tool: "pen" as const, color: "#ef4444" as const, points });

describe("eraseAt", () => {
  it("leaves strokes it doesn't touch, and returns the same array so nothing is republished", () => {
    const strokes = [pen([0, 0, 10, 0])];
    expect(eraseAt(strokes, 500, 500, 5, 5)).toBe(strokes);
  });
  it("splits a stroke around what it erases", () => {
    const out = eraseAt([pen([0, 0, 10, 0, 20, 0, 30, 0, 40, 0])], 20, 0, 2, 2);
    expect(out.map((s) => s.points)).toEqual([[0, 0, 10, 0], [30, 0, 40, 0]]);
  });
  it("removes a stroke entirely when all of it is touched", () => {
    expect(eraseAt([pen([10, 10, 11, 11])], 10, 10, 5, 5)).toEqual([]);
  });
  it("catches a stroke passing between two far-apart points", () => {
    const out = eraseAt([pen([0, 0, 100, 0])], 50, 0, 2, 2);
    expect(out.map((s) => s.points)).toEqual([[0, 0], [100, 0]]);
  });
  it("keeps tool and colour on the pieces", () => {
    const out = eraseAt([{ tool: "highlighter" as const, color: "#22c55e" as const, points: [0, 0, 10, 0, 20, 0] }], 10, 0, 1, 1);
    expect(out.every((s) => s.tool === "highlighter" && s.color === "#22c55e")).toBe(true);
    expect(out).toHaveLength(2);
  });
  it("respects a different radius on each axis, since x and y are scaled to the slide", () => {
    const strokes = [pen([0, 10, 0, 20])];
    expect(eraseAt(strokes, 0, 0, 50, 5)).toBe(strokes);
    expect(eraseAt(strokes, 0, 0, 5, 50)).toEqual([]);
  });
});

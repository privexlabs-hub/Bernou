import { describe, expect, it } from "vitest";
import { fit, formatTime, MIN_WINDOW_S, scroll, ticks, zoomAt, zoomTo } from "@/features/editor/viewWindow";

describe("timeline view", () => {
  it("fits the whole recording", () => {
    expect(fit(600)).toEqual({ start: 0, end: 600 });
  });

  it("zooms around a point: that point stays put on screen", () => {
    const w = zoomAt({ start: 0, end: 100 }, 25, 0.5, 100);
    expect(w).toEqual({ start: 12.5, end: 62.5 }); // 25 is still a quarter of the way across
  });

  it("never zooms in past 5 ms, nor out past the recording", () => {
    let w = { start: 0, end: 100 };
    for (let i = 0; i < 100; i++) w = zoomAt(w, 50, 0.5, 100);
    expect(w.end - w.start).toBeCloseTo(MIN_WINDOW_S, 9);
    expect(w.start).toBeLessThanOrEqual(50);
    expect(w.end).toBeGreaterThanOrEqual(50);
    expect(zoomAt({ start: 10, end: 20 }, 15, 1000, 100)).toEqual({ start: 0, end: 100 });
  });

  it("scrolls, and stops at either end", () => {
    expect(scroll({ start: 10, end: 20 }, 5, 100)).toEqual({ start: 15, end: 25 });
    expect(scroll({ start: 10, end: 20 }, -50, 100)).toEqual({ start: 0, end: 10 });
    expect(scroll({ start: 10, end: 20 }, 500, 100)).toEqual({ start: 90, end: 100 });
  });

  it("zoom to a selection leaves a margin round it", () => {
    const w = zoomTo({ start: 10, end: 10.002 }, 100);
    expect(w.start).toBeLessThan(10);
    expect(w.end).toBeGreaterThan(10.002);
    expect(w.end - w.start).toBeGreaterThanOrEqual(MIN_WINDOW_S);
  });

  it("ruler marks are evenly spaced, at least 70 px apart, and labelled to the needed precision", () => {
    for (const span of [600, 10, 0.5, 0.02, MIN_WINDOW_S]) {
      const t = ticks({ start: 3, end: 3 + span }, 1000);
      expect(t.length).toBeGreaterThan(1);
      const step = t[1]!.t - t[0]!.t;
      expect((step / span) * 1000).toBeGreaterThanOrEqual(70);
      for (const x of t) expect(x.t).toBeGreaterThanOrEqual(3);
    }
    expect(ticks({ start: 62, end: 62.02 }, 1000).some((x) => /^1:02\.0\d\d$/.test(x.label))).toBe(true);
  });

  it("formats times at the precision asked for", () => {
    expect(formatTime(62.3456, 1)).toBe("1:02");
    expect(formatTime(62.3456, 0.1)).toBe("1:02.3");
    expect(formatTime(62.3456, 0.001)).toBe("1:02.346");
  });
});

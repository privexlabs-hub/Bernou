import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "../src/scheduler";

describe("scheduler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps running after a tick throws, and logs it once", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    let calls = 0;
    const sched = createScheduler(30);
    sched.start(() => {
      calls++;
      throw new Error("bad frame");
    });
    for (let i = 0; i < 3; i++) frames.shift()!(i * 34); // a 30 fps interval apart, so none is skipped
    sched.stop();

    expect(calls).toBe(3);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  /** Runs a visible scheduler against a display refreshing at `hz` for `seconds`, counting ticks. */
  function ticksAt(hz: number, seconds = 2, targetFps = 30, jitterMs = 0): number[] {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const ticks: number[] = [];
    const sched = createScheduler(targetFps);
    sched.start((ts) => ticks.push(ts));
    const period = 1000 / hz;
    for (let i = 0; i * period < seconds * 1000; i++) {
      const wobble = jitterMs ? (i % 2 ? jitterMs : -jitterMs) : 0;
      frames.shift()!(i * period + wobble);
    }
    sched.stop();
    return ticks;
  }

  it("draws at its target rate on a 60 Hz display, not at every refresh", () => {
    const ticks = ticksAt(60);
    expect(ticks.length).toBe(60); // 30 a second for 2 s
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(30); // never two refreshes in a row
  });

  it("the first frame draws straight away", () => {
    expect(ticksAt(60)[0]).toBe(0);
  });

  for (const hz of [75, 90, 120, 144]) {
    it(`about 30 a second on a ${hz} Hz display`, () => {
      expect(ticksAt(hz).length).toBeGreaterThanOrEqual(58);
      expect(ticksAt(hz).length).toBeLessThanOrEqual(61);
    });
  }

  it("a frame arriving a little early still counts, so timing jitter doesn't halve the rate", () => {
    expect(ticksAt(60, 2, 30, 1.5).length).toBeGreaterThanOrEqual(58);
  });

  it("a display slower than the target draws on every refresh", () => {
    expect(ticksAt(20).length).toBe(40);
  });

  it("after a long stall it picks up at the target rate, without a burst of catch-up frames", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const ticks: number[] = [];
    const sched = createScheduler(30);
    sched.start((ts) => ticks.push(ts));
    let t = 0;
    for (let i = 0; i < 10; i++) frames.shift()!((t += 1000 / 60));
    t += 1000; // the main thread was blocked for a second
    const before = ticks.length;
    for (let i = 0; i < 6; i++) frames.shift()!((t += 1000 / 60));
    sched.stop();
    expect(ticks.length - before).toBe(3); // 100 ms at 30 fps
  });
});


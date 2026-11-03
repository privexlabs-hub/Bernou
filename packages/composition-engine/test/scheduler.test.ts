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
    for (let i = 0; i < 3; i++) frames.shift()!(i);
    sched.stop();

    expect(calls).toBe(3);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

/**
 * Frame scheduler.
 *
 * Browsers throttle requestAnimationFrame in hidden or occluded documents,
 * which would freeze a recording or a shared audience window. Strategy:
 *   - visible: requestAnimationFrame (vsync-aligned, cheapest), but only at
 *              the target rate: at every refresh, a 60 Hz display would draw
 *              twice as often as the recorder captures, and that extra main-
 *              thread work made recordings stutter on a busy machine
 *   - hidden:  setTimeout at the target fps (Chromium clamps timers in hidden
 *              tabs to 1/s after a while; a Worker-driven tick avoids most of
 *              that, so we prefer a tiny inline Worker when available)
 *
 * The engine does not care which strategy is active; it just gets ticks.
 */
export interface Scheduler {
  start(tick: (ts: number) => void): void;
  stop(): void;
  /** Current strategy, for diagnostics. */
  mode(): "raf" | "worker" | "timeout" | "stopped";
}

const WORKER_SRC = `
let id = null, interval = 33;
self.onmessage = (e) => {
  if (e.data.type === 'start') { interval = e.data.interval; if (id) clearInterval(id); id = setInterval(() => self.postMessage(0), interval); }
  if (e.data.type === 'stop') { if (id) clearInterval(id); id = null; }
};`;

export function createScheduler(targetFps = 30, doc: Document | null = typeof document !== "undefined" ? document : null): Scheduler {
  let tick: ((ts: number) => void) | null = null;
  let rafId = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let worker: Worker | null = null;
  let current: "raf" | "worker" | "timeout" | "stopped" = "stopped";
  const interval = Math.round(1000 / targetFps);
  // Visible frames: an exact interval, and a little slack, since frame times
  // jitter and one that's barely early mustn't wait a whole extra refresh.
  const frameInterval = 1000 / targetFps;
  const EARLY_MS = 2;
  let next = -Infinity;

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // One bad frame must not end the output. Logged once: this runs at frame rate.
  let reported = false;
  const safeTick = (ts: number) => {
    try {
      tick?.(ts);
    } catch (e) {
      if (!reported) console.error("composition-engine: frame failed", e);
      reported = true;
    }
  };

  const loopRaf = () => {
    rafId = requestAnimationFrame((ts) => {
      if (ts >= next - EARLY_MS) {
        // Far behind (a stall, or the first frame): restart from now rather than catch up.
        next = ts - next > frameInterval ? ts + frameInterval : next + frameInterval;
        safeTick(ts);
      }
      if (current === "raf") loopRaf();
    });
  };

  const startWorker = () => {
    try {
      const blob = new Blob([WORKER_SRC], { type: "text/javascript" });
      worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = () => safeTick(now());
      worker.postMessage({ type: "start", interval });
      return true;
    } catch {
      return false;
    }
  };

  const loopTimeout = () => {
    timeoutId = setTimeout(() => {
      safeTick(now());
      if (current === "timeout") loopTimeout();
    }, interval);
  };

  const stopCurrent = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    if (worker) {
      worker.postMessage({ type: "stop" });
      worker.terminate();
      worker = null;
    }
  };

  const choose = () => {
    stopCurrent();
    next = -Infinity;
    if (!tick) {
      current = "stopped";
      return;
    }
    const visible = !doc || doc.visibilityState === "visible";
    if (visible && typeof requestAnimationFrame === "function") {
      current = "raf";
      loopRaf();
    } else if (typeof Worker !== "undefined" && typeof Blob !== "undefined" && startWorker()) {
      current = "worker";
    } else {
      current = "timeout";
      loopTimeout();
    }
  };

  const onVisibility = () => choose();

  return {
    start(t) {
      tick = t;
      doc?.addEventListener("visibilitychange", onVisibility);
      choose();
    },
    stop() {
      tick = null;
      doc?.removeEventListener("visibilitychange", onVisibility);
      stopCurrent();
      current = "stopped";
    },
    mode: () => current,
  };
}

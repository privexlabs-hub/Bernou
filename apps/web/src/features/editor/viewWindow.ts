/** The timeline's visible window, zooming and its ruler. Pure. */
import type { TimeRange } from "@/db/dexie";

export type ViewWindow = TimeRange;

/** Closest zoom: 5 ms across the timeline, about 240 samples at 48 kHz. */
export const MIN_WINDOW_S = 0.005;

export const fit = (duration: number): ViewWindow => ({ start: 0, end: Math.max(MIN_WINDOW_S, duration) });

function clampWindow(start: number, len: number, duration: number): ViewWindow {
  const l = Math.min(Math.max(len, MIN_WINDOW_S), Math.max(duration, MIN_WINDOW_S));
  const s = Math.min(Math.max(0, start), Math.max(0, duration - l));
  return { start: s, end: s + l };
}

/** Zooms by `factor` (below 1 is closer) keeping `pivot` at the same place on screen. */
export function zoomAt(w: ViewWindow, pivot: number, factor: number, duration: number): ViewWindow {
  const len = w.end - w.start;
  const next = Math.min(Math.max(len * factor, MIN_WINDOW_S), Math.max(duration, MIN_WINDOW_S));
  const frac = len > 0 ? (pivot - w.start) / len : 0.5;
  return clampWindow(pivot - frac * next, next, duration);
}

export const scroll = (w: ViewWindow, dt: number, duration: number): ViewWindow => clampWindow(w.start + dt, w.end - w.start, duration);

/** Shows a range with a margin of a fifth of its length on each side. */
export function zoomTo(r: TimeRange, duration: number): ViewWindow {
  const len = Math.max(MIN_WINDOW_S, (r.end - r.start) * 1.4);
  return clampWindow((r.start + r.end) / 2 - len / 2, len, duration);
}

const STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
const MIN_TICK_PX = 70;

/** `m:ss`, with as many decimals as `step` needs. */
export function formatTime(t: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(decimals);
  const [whole, frac] = s.split(".");
  return `${m}:${whole!.padStart(2, "0")}${frac ? `.${frac}` : ""}`;
}

/** Ruler marks for a window drawn `widthPx` wide. */
export function ticks(w: ViewWindow, widthPx: number): { t: number; label: string }[] {
  const span = w.end - w.start;
  const step = STEPS.find((s) => (s / span) * widthPx >= MIN_TICK_PX) ?? STEPS[STEPS.length - 1]!;
  const out: { t: number; label: string }[] = [];
  // Whole multiples of the step, counted in integers so they don't drift.
  for (let k = Math.ceil(w.start / step - 1e-9); k * step <= w.end + 1e-9; k++) {
    const t = +(k * step).toFixed(6);
    out.push({ t, label: formatTime(t, step) });
  }
  return out;
}

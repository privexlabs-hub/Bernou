/**
 * Pure teleprompter scroll model. No DOM. Time-based so playback speed is
 * independent of frame rate, and frame drops never make the text jump.
 *
 *   position: px scrolled from the top
 *   speed:    px per second (positive scrolls forward)
 *   state:    idle | playing | paused
 */
/** Speed limits, in px per second. */
export const MIN_SPEED = 1;
export const MAX_SPEED = 400;
const FINE_STEP_BELOW = 10;
const COARSE_STEP = 5;

export type PrompterStatus = "idle" | "playing" | "paused";

export interface ScrollModel {
  status: PrompterStatus;
  position: number;
  speed: number;
  /** Total scrollable height; position is clamped to [0, maxPosition]. */
  maxPosition: number;
  /** Timestamp of the last tick while playing. */
  lastTs: number | null;
}

export function createScrollModel(speed = 40): ScrollModel {
  return { status: "idle", position: 0, speed, maxPosition: 0, lastTs: null };
}

export function start(m: ScrollModel, ts: number): ScrollModel {
  return { ...m, status: "playing", lastTs: ts };
}

export function pause(m: ScrollModel): ScrollModel {
  return m.status === "playing" ? { ...m, status: "paused", lastTs: null } : m;
}

export function resume(m: ScrollModel, ts: number): ScrollModel {
  return m.status === "paused" ? { ...m, status: "playing", lastTs: ts } : m;
}

export function toggle(m: ScrollModel, ts: number): ScrollModel {
  if (m.status === "playing") return pause(m);
  return start(m, ts);
}

/** Stop and keep the position (so the presenter can see where they were). */
export function stop(m: ScrollModel): ScrollModel {
  return { ...m, status: "idle", lastTs: null };
}

/** Reset to the top; keeps the status (a playing prompter restarts from 0). */
export function reset(m: ScrollModel): ScrollModel {
  return { ...m, position: 0 };
}

export function setSpeed(m: ScrollModel, speed: number): ScrollModel {
  return { ...m, speed: clampSpeed(speed) };
}

export function clampSpeed(speed: number): number {
  return clamp(speed, MIN_SPEED, MAX_SPEED);
}

/** The next speed on the buttons: by 1 where small changes matter, by 5 above that. */
export function nextSpeed(speed: number, direction: 1 | -1): number {
  const isFine = direction > 0 ? speed < FINE_STEP_BELOW : speed <= FINE_STEP_BELOW;
  if (isFine) return clampSpeed(speed + direction);
  const next = direction > 0 ? Math.floor(speed / COARSE_STEP + 1) * COARSE_STEP : Math.ceil(speed / COARSE_STEP - 1) * COARSE_STEP;
  return clampSpeed(next);
}

export function setMaxPosition(m: ScrollModel, max: number): ScrollModel {
  const maxPosition = Math.max(0, max);
  return { ...m, maxPosition, position: clamp(m.position, 0, maxPosition) };
}

/** Manual scroll (wheel / drag). Allowed in any state; does not change status. */
export function nudge(m: ScrollModel, deltaPx: number): ScrollModel {
  return { ...m, position: clamp(m.position + deltaPx, 0, m.maxPosition) };
}

export function seek(m: ScrollModel, position: number): ScrollModel {
  return { ...m, position: clamp(position, 0, m.maxPosition) };
}

/**
 * Advance by elapsed time. Returns the same object if nothing changed.
 * Large gaps (tab was hidden) are capped so the text doesn't leap.
 */
export function tick(m: ScrollModel, ts: number): ScrollModel {
  if (m.status !== "playing") return m;
  if (m.lastTs === null) return { ...m, lastTs: ts };
  const dt = Math.min(0.25, Math.max(0, (ts - m.lastTs) / 1000));
  const position = clamp(m.position + m.speed * dt, 0, m.maxPosition);
  const reachedEnd = position >= m.maxPosition && m.maxPosition > 0;
  return { ...m, position, lastTs: ts, status: reachedEnd ? "paused" : "playing" };
}

/** 0..1 progress for a position indicator. */
export function progress(m: ScrollModel): number {
  return m.maxPosition <= 0 ? 0 : m.position / m.maxPosition;
}

/** Seconds remaining at the current speed. */
export function remainingSeconds(m: ScrollModel): number {
  if (m.speed <= 0) return Infinity;
  return Math.max(0, (m.maxPosition - m.position) / m.speed);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

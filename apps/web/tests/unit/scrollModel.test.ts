import { describe, expect, it } from "vitest";
import { createScrollModel, nudge, pause, progress, remainingSeconds, reset, resume, seek, setMaxPosition, setSpeed, start, stop, tick, toggle } from "@/features/teleprompter/scrollModel";

const base = () => setMaxPosition(createScrollModel(100), 1000);

describe("teleprompter scroll model", () => {
  it("does not move while idle or paused", () => {
    let m = base();
    expect(tick(m, 1000).position).toBe(0);
    m = pause(start(m, 0));
    expect(tick(m, 5000).position).toBe(0);
  });

  it("moves at speed px/s independent of frame rate", () => {
    let a = start(base(), 0);
    for (let t = 16; t <= 1008; t += 16) a = tick(a, t);
    a = tick(a, 1000); // land exactly on 1000ms (a tick backwards in time is clamped to dt=0)
    let b = start(base(), 0);
    for (let t = 100; t <= 1000; t += 100) b = tick(b, t);
    expect(Math.abs(a.position - b.position)).toBeLessThan(2);
    expect(b.position).toBeCloseTo(100, 5);
  });

  it("caps large gaps so a hidden tab doesn't jump the text", () => {
    let m = start(base(), 0);
    m = tick(m, 10_000); // 10s gap → capped to 0.25s
    expect(m.position).toBeCloseTo(25);
  });

  it("pause/resume keep position; stop keeps position; reset goes to 0", () => {
    let m = start(base(), 0);
    for (let t = 100; t <= 500; t += 100) m = tick(m, t);
    m = pause(m);
    expect(m.position).toBeCloseTo(50);
    m = resume(m, 1000);
    for (let t = 1100; t <= 1500; t += 100) m = tick(m, t);
    expect(m.position).toBeCloseTo(100);
    m = stop(m);
    expect(m.status).toBe("idle");
    expect(m.position).toBeCloseTo(100);
    m = reset(m);
    expect(m.position).toBe(0);
  });

  it("toggle alternates play/pause from any state", () => {
    let m = toggle(base(), 0);
    expect(m.status).toBe("playing");
    m = toggle(m, 10);
    expect(m.status).toBe("paused");
    m = toggle(m, 20);
    expect(m.status).toBe("playing");
  });

  it("stops at the end and pauses", () => {
    let m = start(setMaxPosition(createScrollModel(1000), 200), 0);
    m = tick(m, 100);
    m = tick(m, 300);
    expect(m.position).toBe(200);
    expect(m.status).toBe("paused");
  });

  it("manual nudge/seek clamp and work while playing", () => {
    let m = start(base(), 0);
    m = nudge(m, -50);
    expect(m.position).toBe(0);
    m = nudge(m, 5000);
    expect(m.position).toBe(1000);
    m = seek(m, 400);
    expect(m.position).toBe(400);
    expect(m.status).toBe("playing");
  });

  it("speed is clamped and progress/remaining are derived", () => {
    let m = setSpeed(base(), 1);
    expect(m.speed).toBe(5);
    m = setSpeed(m, 100);
    m = seek(m, 250);
    expect(progress(m)).toBeCloseTo(0.25);
    expect(remainingSeconds(m)).toBeCloseTo(7.5);
  });

  it("shrinking maxPosition clamps position", () => {
    let m = seek(base(), 900);
    m = setMaxPosition(m, 500);
    expect(m.position).toBe(500);
  });
});

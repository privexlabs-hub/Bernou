import { describe, expect, it } from "vitest";
import { anchorAt, createScrollModel, nudge, pause, positionFor, progress, remainingSeconds, reset, resume, seek, setMaxPosition, setSpeed, start, stop, tick, toggle, nextSpeed } from "@/features/teleprompter/scrollModel";

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
    expect(setSpeed(base(), 0).speed).toBe(1);
    expect(setSpeed(base(), 1).speed).toBe(1);
    expect(setSpeed(base(), 9999).speed).toBe(400);
    let m = base();
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

describe("nextSpeed", () => {
  it("steps by 1 up to 10, then by 5", () => {
    expect(nextSpeed(10, -1)).toBe(9);
    expect(nextSpeed(2, -1)).toBe(1);
    expect(nextSpeed(9, 1)).toBe(10);
    expect(nextSpeed(10, 1)).toBe(15);
    expect(nextSpeed(15, -1)).toBe(10);
    expect(nextSpeed(40, 1)).toBe(45);
  });
  it("stops at the limits", () => {
    expect(nextSpeed(1, -1)).toBe(1);
    expect(nextSpeed(400, 1)).toBe(400);
  });
  it("gets back onto the steps from a slider value", () => {
    expect(nextSpeed(37, 1)).toBe(40);
    expect(nextSpeed(37, -1)).toBe(35);
  });
});

describe("reading anchor", () => {
  const boxes = [
    { id: "a", top: 100, height: 200 },
    { id: "b", top: 320, height: 100 },
    { id: "c", top: 440, height: 400 },
  ];

  it("finds the section under the line and how far into it the line is", () => {
    expect(anchorAt(boxes, 200)).toEqual({ sectionId: "a", fraction: 0.5 });
    expect(anchorAt(boxes, 340)).toEqual({ sectionId: "b", fraction: 0.2 });
  });

  it("the first section's top and the last section's end", () => {
    expect(anchorAt(boxes, 100)).toEqual({ sectionId: "a", fraction: 0 });
    expect(anchorAt(boxes, 840)).toEqual({ sectionId: "c", fraction: 1 });
    expect(anchorAt(boxes, 5000)).toEqual({ sectionId: "c", fraction: 1 });
  });

  it("the gap between sections counts as the end of the one above", () => {
    expect(anchorAt(boxes, 310)).toEqual({ sectionId: "a", fraction: 1 });
  });

  it("has nothing to anchor to above the first section, or with no sections", () => {
    expect(anchorAt(boxes, 50)).toBeNull();
    expect(anchorAt([], 50)).toBeNull();
  });

  it("converts back to the same place after the text rewraps", () => {
    const anchor = anchorAt(boxes, 200)!;
    const rewrapped = [
      { id: "a", top: 100, height: 600 },
      { id: "b", top: 720, height: 300 },
      { id: "c", top: 1040, height: 900 },
    ];
    // Line 80px down the viewport: section top 100 + half of 600, less the line.
    expect(positionFor(anchor, rewrapped, 80)).toBe(320);
  });

  it("does not go above the top", () => {
    expect(positionFor({ sectionId: "a", fraction: 0 }, boxes, 500)).toBe(0);
  });

  it("ignores an anchor whose section has gone", () => {
    expect(positionFor({ sectionId: "gone", fraction: 0.5 }, boxes, 80)).toBeNull();
    expect(positionFor(null, boxes, 80)).toBeNull();
    expect(positionFor({ sectionId: "a", fraction: 0.5 }, [], 80)).toBeNull();
  });
});

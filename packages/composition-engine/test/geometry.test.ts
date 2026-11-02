import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cameraRect, coverCrop, fitContain, pointInCamera, pointOnResizeHandle } from "../src/geometry";
import type { CameraSpec } from "@bernou/audience-protocol";

const cam = (o: Partial<CameraSpec> = {}): CameraSpec => ({
  enabled: true,
  deviceId: null,
  shape: "circle",
  x: 0.7,
  y: 0.6,
  size: 0.2,
  aspect: 1,
  cornerRadius: 0.1,
  border: { width: 2, color: "#fff" },
  shadow: false,
  mirror: false,
  opacity: 1,
  ...o,
});

describe("fitContain", () => {
  it("pillarboxes a 4:3 slide in a 16:9 output", () => {
    const r = fitContain(1024, 768, 1920, 1080);
    expect(r.h).toBe(1080);
    expect(r.w).toBe(1440);
    expect(r.x).toBe(240);
    expect(r.y).toBe(0);
  });
  it("letterboxes an ultrawide slide", () => {
    const r = fitContain(2400, 600, 1920, 1080);
    expect(r.w).toBe(1920);
    expect(r.h).toBe(480);
    expect(r.y).toBe(300);
  });
  it("never exceeds the destination", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8000 }), fc.integer({ min: 1, max: 8000 }), fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 1, max: 4000 }), (sw, sh, dw, dh) => {
        const r = fitContain(sw, sh, dw, dh);
        expect(r.w).toBeLessThanOrEqual(dw + 1e-6);
        expect(r.h).toBeLessThanOrEqual(dh + 1e-6);
        expect(r.x).toBeGreaterThanOrEqual(-1e-6);
        expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      }),
    );
  });
});

describe("coverCrop", () => {
  it("crops the sides of a wide source for a square target", () => {
    const c = coverCrop(1280, 720, 300, 300);
    expect(c.h).toBe(720);
    expect(c.w).toBe(720);
    expect(c.x).toBe(280);
  });
  it("crops top/bottom of a tall source for a wide target", () => {
    const c = coverCrop(720, 1280, 400, 200);
    expect(c.w).toBe(720);
    expect(c.h).toBe(360);
    expect(c.y).toBe(460);
  });
});

describe("cameraRect / hit testing", () => {
  it("circle rect is square", () => {
    const r = cameraRect(cam(), 1920, 1080);
    expect(r.w).toBe(384);
    expect(r.h).toBe(384);
    expect(r.x).toBeCloseTo(1344);
    expect(r.y).toBeCloseTo(648);
  });
  it("rect uses aspect", () => {
    const r = cameraRect(cam({ shape: "rect", aspect: 16 / 9 }), 1920, 1080);
    expect(r.w).toBe(384);
    expect(r.h).toBeCloseTo(216);
  });
  it("hit-tests circles by radius, not bounding box", () => {
    const c = cam();
    const r = cameraRect(c, 1920, 1080);
    // corner of the bounding box is outside the circle
    expect(pointInCamera(r.x + 1, r.y + 1, c, 1920, 1080)).toBe(false);
    expect(pointInCamera(r.x + r.w / 2, r.y + r.h / 2, c, 1920, 1080)).toBe(true);
  });
  it("resize handle is at bottom-right", () => {
    const c = cam();
    const r = cameraRect(c, 1920, 1080);
    expect(pointOnResizeHandle(r.x + r.w, r.y + r.h, c, 1920, 1080, 12)).toBe(true);
    expect(pointOnResizeHandle(r.x, r.y, c, 1920, 1080, 12)).toBe(false);
  });
});

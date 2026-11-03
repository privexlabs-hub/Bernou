import { describe, expect, it } from "vitest";
import { cameraHint } from "@/features/preview/cameraHintKind";

const base = { layout: "slide-with-camera", live: false, busy: false, hasError: false, stalled: false };

describe("cameraHint", () => {
  it("says nothing while the camera is starting", () => {
    expect(cameraHint({ ...base, busy: true })).toBeNull();
    expect(cameraHint({ ...base, busy: true, hasError: true })).toBeNull();
  });
  it("offers to turn it on when the layout needs it", () => {
    expect(cameraHint(base)).toBe("off");
    expect(cameraHint({ ...base, layout: "camera-full" })).toBe("off");
  });
  it("stays quiet when no camera is wanted", () => {
    expect(cameraHint({ ...base, layout: "slide-full" })).toBeNull();
    expect(cameraHint({ ...base, layout: "blank" })).toBeNull();
  });
  it("reports a live camera the layout is hiding", () => {
    expect(cameraHint({ ...base, live: true, layout: "slide-full" })).toBe("hidden");
  });
  it("says nothing when the camera is live and visible", () => {
    expect(cameraHint({ ...base, live: true })).toBeNull();
    expect(cameraHint({ ...base, live: true, layout: "camera-full" })).toBeNull();
  });
  it("reports errors in any layout, ahead of the off hint", () => {
    expect(cameraHint({ ...base, hasError: true })).toBe("error");
    expect(cameraHint({ ...base, hasError: true, layout: "slide-full" })).toBe("error");
  });
  it("reports a frozen camera when it would be visible", () => {
    expect(cameraHint({ ...base, live: true, stalled: true })).toBe("stalled");
    expect(cameraHint({ ...base, live: true, stalled: true, layout: "slide-full" })).toBe("hidden");
  });
});

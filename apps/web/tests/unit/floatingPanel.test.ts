import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampPanelBox, loadPanelBox, MIN_PANEL_HEIGHT, MIN_PANEL_WIDTH, savePanelBox } from "@/features/teleprompter/floatingWindow";

describe("floating panel box", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stays inside the window", () => {
    expect(clampPanelBox({ x: -50, y: -50, width: 300, height: 200 }, 1000, 800)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(clampPanelBox({ x: 5000, y: 5000, width: 300, height: 200 }, 1000, 800)).toEqual({ x: 700, y: 600, width: 300, height: 200 });
  });

  it("is never bigger than the window, nor smaller than its minimum", () => {
    expect(clampPanelBox({ x: 0, y: 0, width: 3000, height: 3000 }, 1000, 800)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(clampPanelBox({ x: 0, y: 0, width: 10, height: 10 }, 1000, 800)).toMatchObject({ width: MIN_PANEL_WIDTH, height: MIN_PANEL_HEIGHT });
  });

  it("starts at the top centre", () => {
    expect(loadPanelBox(1000, 800)).toEqual({ x: 220, y: 8, width: 560, height: 260 });
  });

  it("comes back where it was saved, clamped to today's window", () => {
    savePanelBox({ x: 900, y: 700, width: 300, height: 200 });
    expect(loadPanelBox(2000, 2000)).toEqual({ x: 900, y: 700, width: 300, height: 200 });
    expect(loadPanelBox(1000, 800)).toEqual({ x: 700, y: 600, width: 300, height: 200 });
  });

  it("falls back to the default on corrupt or partly wrong storage", () => {
    localStorage.setItem("bernou-float-panel", "{not json");
    expect(loadPanelBox(1000, 800)).toEqual({ x: 220, y: 8, width: 560, height: 260 });
    localStorage.setItem("bernou-float-panel", JSON.stringify({ x: "left", y: null, width: 300 }));
    expect(loadPanelBox(1000, 800)).toEqual({ x: 350, y: 8, width: 300, height: 260 });
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(loadPanelBox(1000, 800).width).toBe(560);
    expect(() => savePanelBox({ x: 0, y: 0, width: 300, height: 200 })).not.toThrow();
  });
});

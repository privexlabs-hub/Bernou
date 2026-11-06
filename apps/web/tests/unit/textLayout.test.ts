import { describe, expect, it } from "vitest";
import { DEFAULT_TELEPROMPTER } from "@/db/dexie";
import { CAMERA_LAYOUT, layoutPatch, textLayout } from "@/features/teleprompter/textLayout";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";

describe("prompter text layout", () => {
  const settings = { ...DEFAULT_TELEPROMPTER, fontSize: 30, readingLine: 0.4, readingZone: 0.7, align: "left" as const, floatFontSize: 20, floatReadingLine: 0.15, floatReadingZone: 0.45, floatAlign: "center" as const };

  it("the tab uses its own values", () => {
    expect(textLayout(settings, false)).toEqual({ fontSize: 30, readingLine: 0.4, readingZone: 0.7, align: "left" });
  });

  it("the float uses its own values", () => {
    expect(textLayout(settings, true)).toEqual({ fontSize: 20, readingLine: 0.15, readingZone: 0.45, align: "center" });
  });

  it("an edit goes to the place showing the text, and only there", () => {
    expect(layoutPatch({ fontSize: 24, align: "left" }, true)).toEqual({ floatFontSize: 24, floatAlign: "left" });
    expect(layoutPatch({ readingLine: 0.2, readingZone: 0.3 }, false)).toEqual({ readingLine: 0.2, readingZone: 0.3 });
  });

  it("the camera layout: near the top, smaller, centred", () => {
    expect(CAMERA_LAYOUT).toEqual({ floatFontSize: 22, floatReadingLine: 0.1, floatReadingZone: 0.5, floatAlign: "center" });
    expect(DEFAULT_TELEPROMPTER).toMatchObject(CAMERA_LAYOUT);
  });

  it("a presentation saved before the float had its own layout opens with the camera layout", () => {
    const { floatFontSize: _a, floatReadingLine: _b, floatReadingZone: _c, floatAlign: _d, ...old } = DEFAULT_TELEPROMPTER;
    useTeleprompterStore.getState().loadSettings({ ...old, fontSize: 34 } as typeof DEFAULT_TELEPROMPTER);
    expect(useTeleprompterStore.getState().settings).toMatchObject({ fontSize: 34, ...CAMERA_LAYOUT });
  });
});

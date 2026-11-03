import { describe, expect, it } from "vitest";
import { recordingFileName } from "@/features/recording/recordingFile";

const at = new Date(2026, 10, 3, 9, 5).getTime();

describe("recordingFileName", () => {
  it("names the file after the presentation and when it was recorded", () => {
    expect(recordingFileName("Lecture 3", at, "mp4")).toBe("Lecture 3-2026-11-03-0905.mp4");
  });
  it("removes characters file systems reject, keeps non-English titles, and can't escape a folder", () => {
    expect(recordingFileName('a/b\\c:d*e?"f<g>h|i', at, "mp4")).toBe("a b c d e f g h i-2026-11-03-0905.mp4");
    expect(recordingFileName("Réunion 会議", at, "webm")).toBe("Réunion 会議-2026-11-03-0905.webm");
    expect(recordingFileName("../../secret", at, "mp4")).toBe("secret-2026-11-03-0905.mp4");
  });
  it("falls back when nothing is left of the title", () => {
    expect(recordingFileName("///", at, "mp4")).toBe("Recording-2026-11-03-0905.mp4");
  });
});

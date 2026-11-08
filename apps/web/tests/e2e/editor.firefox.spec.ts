import { expect, test } from "@playwright/test";
import { exportVideo, installFakeSource, recordAndOpenEditor, select } from "./editorHelpers";

test.setTimeout(240_000);

/** Firefox can't encode AAC, so the editor exports WebM there, and says so before exporting. */
test("Firefox: a cut exports as WebM, shorter by the cut", async ({ page, browserName }) => {
  test.skip(browserName !== "firefox");
  await installFakeSource(page);
  await recordAndOpenEditor(page, 6);
  const before = Number(await page.getByTestId("editor").getAttribute("data-duration"));
  await select(page, 1, 3);
  await page.getByTestId("editor-remove").click();
  const dl = await exportVideo(page);
  await expect(page.getByTestId("editor-export-dialog")).toContainText("WebM");
  expect(dl.suggestedFilename()).toMatch(/\.webm$/);
  const path = await dl.path();
  const bytes = (await import("node:fs")).readFileSync(path);
  expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3"); // EBML: a WebM file
  // Its length, read by the browser.
  const duration = await page.evaluate(async (b64) => {
    const v = document.createElement("video");
    v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "video/webm" }));
    await new Promise((r) => (v.onloadedmetadata = r));
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e9;
      await new Promise((r) => (v.ontimeupdate = r));
    }
    return v.duration;
  }, bytes.toString("base64"));
  expect(Math.abs(duration - (before - 2))).toBeLessThan(0.2);
});

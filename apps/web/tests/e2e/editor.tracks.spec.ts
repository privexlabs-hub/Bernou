import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileInfo, loadRecording, pixelAt, toneLevels } from "./recordingProbe";
import { exportVideo, installFakeSource, recordAndOpenEditor, select } from "./editorHelpers";

test.skip(({ browserName }) => browserName !== "chromium", "the media tests run on Chromium");
test.setTimeout(300_000);

const editorDuration = async (page: Page) => Number(await page.getByTestId("editor").getAttribute("data-duration"));
const hasSoundTrack = (bytes: Buffer) => bytes.includes(Buffer.from("soun"));
const SHIFT_STRIP = 12;

/** Where things are on the timeline canvas, from what it reports about itself. */
async function geometry(tl: Locator) {
  const box = (await tl.boundingBox())!;
  const vs = Number(await tl.getAttribute("data-view-start"));
  const ve = Number(await tl.getAttribute("data-view-end"));
  const soundY = Number(await tl.getAttribute("data-sound-y"));
  const videoY = Number(await tl.getAttribute("data-video-y"));
  return {
    x: (t: number) => box.x + ((t - vs) / (ve - vs)) * box.width,
    pxPerSecond: box.width / (ve - vs),
    /** Inside the gap marks, below the shift strip. */
    soundY: box.y + soundY + SHIFT_STRIP + 25,
    stripY: box.y + soundY + SHIFT_STRIP / 2,
    videoY: box.y + videoY + 20,
    rulerY: box.y + 8,
  };
}
async function gaps(tl: Locator): Promise<{ start: number; end: number }[]> {
  const s = (await tl.getAttribute("data-gaps")) ?? "";
  return s ? s.split(" ").map((r) => { const [a, b] = r.split("-").map(Number); return { start: a!, end: b! }; }) : [];
}
/** The longest gap clear of the ends, so a click on it is a click on a real pause. */
async function innerGap(tl: Locator, duration: number) {
  const list = (await gaps(tl)).filter((g) => g.start > 0.3 && g.end < duration - 0.3);
  expect(list.length).toBeGreaterThan(0);
  return list.sort((a, b) => b.end - b.start - (a.end - a.start))[0]!;
}

test("gaps are found on their own, highlighted on hover, deleted by a click, and back with undo", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 12);
  const tl = page.getByTestId("editor-timeline");
  await expect.poll(async () => Number(await tl.getAttribute("data-silences"))).toBeGreaterThanOrEqual(2);
  const before = await editorDuration(page);
  const g = await innerGap(tl, before);
  const geo = await geometry(tl);
  await page.mouse.move(geo.x((g.start + g.end) / 2), geo.soundY);
  await expect(tl).not.toHaveAttribute("data-hover-silence", "");
  await page.mouse.click(geo.x((g.start + g.end) / 2), geo.soundY);
  expect(await editorDuration(page)).toBeCloseTo(before - (g.end - g.start), 2);
  await expect(page.getByTestId("editor-status")).toContainText("gap");
  await page.getByTestId("editor-tab-cuts").click();
  await expect(page.getByTestId("editor-cut")).toHaveCount(1);
  // The deleted gap is gone from the list; nothing tiny is left beside the cut.
  for (const r of await gaps(tl)) expect(r.end - r.start).toBeGreaterThanOrEqual(0.5 - 1e-6);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  expect(await editorDuration(page)).toBeCloseTo(before, 3);
});

test("no accidental deletes: a drag that comes back, or a click on the video row or the ruler", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 12);
  const tl = page.getByTestId("editor-timeline");
  await expect.poll(async () => Number(await tl.getAttribute("data-silences"))).toBeGreaterThanOrEqual(1);
  const before = await editorDuration(page);
  const g = await innerGap(tl, before);
  const geo = await geometry(tl);
  const mid = geo.x((g.start + g.end) / 2);
  await page.mouse.move(mid, geo.soundY);
  await page.mouse.down();
  await page.mouse.move(mid + 40, geo.soundY, { steps: 4 });
  await page.mouse.move(mid, geo.soundY, { steps: 4 });
  await page.mouse.up();
  expect(await editorDuration(page)).toBe(before);
  for (const y of [geo.videoY, geo.rulerY]) {
    await page.mouse.click(mid, y);
    expect(await editorDuration(page)).toBe(before);
  }
  // The click on the ruler moved the playhead into the gap.
  await expect.poll(async () => Number((await page.getByTestId("editor-time").textContent())!.split(":")[1]!.split(" ")[0])).toBeCloseTo((g.start + g.end) / 2, 0);
});

test("the sound row mutes all of the recording's sound, and stays on the timeline", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  const tl = page.getByTestId("editor-timeline");
  await expect(tl).toHaveAttribute("data-muted", "false");
  await page.getByTestId("editor-sound-mute").click();
  await expect(tl).toHaveAttribute("data-muted", "true");
  await expect(tl).toHaveAttribute("data-sound-y", /\d+/);
  const bytes = await loadRecording(page, await exportVideo(page));
  expect(hasSoundTrack(bytes)).toBe(false);
  await page.getByTestId("editor-export-done").getByRole("button", { name: "Done" }).click();
  await page.getByTestId("editor-sound-mute").click();
  await expect(tl).toHaveAttribute("data-muted", "false");
});

test("dragging the shift strip moves the sound, and the gaps move with it", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 12);
  const tl = page.getByTestId("editor-timeline");
  await expect.poll(async () => Number(await tl.getAttribute("data-silences"))).toBeGreaterThanOrEqual(1);
  const d = await editorDuration(page);
  const g0 = await innerGap(tl, d);
  const geo = await geometry(tl);
  const from = geo.x(d / 2);
  await page.mouse.move(from, geo.stripY);
  await page.mouse.down();
  await page.mouse.move(from + 0.2 * geo.pxPerSecond, geo.stripY, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId("editor-tab-audio").click();
  const ms = Number(await page.getByTestId("editor-original-offset").inputValue());
  // A pixel is the precision of a drag.
  expect(Math.abs(ms - 200)).toBeLessThanOrEqual(1000 / geo.pxPerSecond + 0.1);
  expect(await editorDuration(page)).toBe(d);
  // The same gap, now later by the shift.
  const moved = (await gaps(tl)).find((g) => Math.abs(g.start - (g0.start + ms / 1000)) < 0.02);
  expect(moved, JSON.stringify(await gaps(tl))).toBeDefined();
  expect(moved!.end - moved!.start).toBeCloseTo(g0.end - g0.start, 2);
  // One undo step for the whole drag.
  await page.getByTestId("editor-undo").click();
  expect(Number(await page.getByTestId("editor-original-offset").inputValue())).toBe(0);
});

test("Delete sound: silence there, the picture and the length unchanged", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 5);
  const d = await editorDuration(page);
  await select(page, 2, 3);
  await page.getByTestId("editor-mute").click();
  await loadRecording(page, await exportVideo(page));
  expect(Math.abs((await fileInfo(page)).duration - d)).toBeLessThan(0.1);
  const [during] = await toneLevels(page, 2.1, 2.9, [1000]);
  const [outside] = await toneLevels(page, 1, 1.8, [1000]);
  expect(outside!).toBeGreaterThan(-20);
  expect(during!).toBeLessThan(-60);
  const [r, g, b] = await pixelAt(page, 2.5, 0.5, 0.5);
  expect(r! + g! + b!).toBeGreaterThan(60); // still the colour time code, not black
});

test("Delete picture: black there, even with the contrast lowered, while the sound carries on", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 5);
  const d = await editorDuration(page);
  await select(page, 2, 3);
  await page.getByTestId("editor-delete-picture").click();
  await expect(page.getByTestId("editor-blank")).toHaveCount(0); // the playhead isn't in it yet
  await page.getByTestId("editor-tab-picture").click();
  const s = page.getByTestId("editor-contrast").getByRole("slider");
  await s.focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("editor-contrast-value")).toHaveText("-50");
  await loadRecording(page, await exportVideo(page));
  expect(Math.abs((await fileInfo(page)).duration - d)).toBeLessThan(0.1);
  const black = await pixelAt(page, 2.5, 0.5, 0.5);
  for (const c of black) expect(c).toBeLessThan(8);
  const [r, g, b] = await pixelAt(page, 1.5, 0.5, 0.5);
  expect(r! + g! + b!).toBeGreaterThan(60);
  const [during] = await toneLevels(page, 2.1, 2.9, [1000]);
  expect(during!).toBeGreaterThan(-20);
});

test("the preview shows black inside a picture cut", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 5);
  await select(page, 2, 3);
  await page.getByTestId("editor-delete-picture").click();
  const tl = page.getByTestId("editor-timeline");
  const geo = await geometry(tl);
  await page.mouse.click(geo.x(2.5), geo.rulerY);
  await expect(page.getByTestId("editor-blank")).toBeVisible();
  await page.mouse.click(geo.x(1.5), geo.rulerY);
  await expect(page.getByTestId("editor-blank")).toHaveCount(0);
});

test("the video row fills with thumbnails", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 6);
  await expect.poll(async () => Number(await page.getByTestId("editor-timeline").getAttribute("data-thumbs")), { timeout: 20_000 }).toBeGreaterThanOrEqual(10);
});

test("a removed part closes up on the timeline, and its seam puts it back", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 5);
  const tl = page.getByTestId("editor-timeline");
  const d = await editorDuration(page);
  await select(page, 2, 3);
  await page.getByTestId("editor-remove").click();
  // No space left behind: the timeline is the final length, with one seam.
  await expect(tl).toHaveAttribute("data-seams", "1");
  expect(Number(await tl.getAttribute("data-span"))).toBeCloseTo(d - 1, 2);
  expect(Number(await tl.getAttribute("data-view-end"))).toBeCloseTo(d - 1, 2);

  // Dragging across the seam selects in the recording's own time, through the removed part.
  let geo = await geometry(tl); // positions on the closed-up timeline
  await page.mouse.move(geo.x(1.5), geo.videoY);
  await page.mouse.down();
  await page.mouse.move(geo.x(2.5), geo.videoY, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.getByTestId("editor-sel-start").inputValue())).toBeCloseTo(1.5, 1);
  expect(Number(await page.getByTestId("editor-sel-end").inputValue())).toBeCloseTo(3.5, 1);

  // The seam: hover, click, put back.
  geo = await geometry(tl);
  await page.mouse.move(geo.x(2), geo.videoY);
  await page.mouse.click(geo.x(2), geo.videoY);
  await expect(page.getByTestId("editor-seam")).toContainText("1.0 s removed");
  await page.getByTestId("editor-seam-restore").click();
  await expect(tl).toHaveAttribute("data-seams", "0");
  expect(await editorDuration(page)).toBeCloseTo(d, 3);
  await page.getByTestId("editor-undo").click();
  await expect(tl).toHaveAttribute("data-seams", "1");

  // Shown at full length on request, hatched, for adjusting a cut's edges.
  await page.getByTestId("editor-show-removed").click();
  await expect(tl).toHaveAttribute("data-seams", "0");
  expect(Number(await tl.getAttribute("data-span"))).toBeCloseTo(d, 2);
  await page.getByTestId("editor-show-removed").click();
  await expect(tl).toHaveAttribute("data-seams", "1");
});

test("dragging an end of a gap shortens it, keeping the rest as a pause", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 12);
  const tl = page.getByTestId("editor-timeline");
  await expect.poll(async () => Number(await tl.getAttribute("data-silences"))).toBeGreaterThanOrEqual(1);
  const before = await editorDuration(page);
  const g = await innerGap(tl, before);
  const geo = await geometry(tl);
  const take = (g.end - g.start) * 0.4;
  // From the gap's right end, inwards.
  await page.mouse.move(geo.x(g.end) - 1, geo.soundY);
  await page.mouse.down();
  await page.mouse.move(geo.x(g.end - take), geo.soundY, { steps: 6 });
  await page.mouse.up();
  const removed = before - (await editorDuration(page));
  expect(Math.abs(removed - take)).toBeLessThan(3 / geo.pxPerSecond);
  await expect(page.getByTestId("editor-status")).toContainText("Shortened a gap");
  await page.getByTestId("editor-tab-cuts").click();
  await expect(page.getByTestId("editor-cut")).toHaveCount(1);
  await page.getByTestId("editor-undo").click();
  expect(await editorDuration(page)).toBeCloseTo(before, 3);
});

test("while playing zoomed in, scrolling elsewhere stays put, and the scrollbar goes anywhere", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 8);
  const tl = page.getByTestId("editor-timeline");
  const view = async () => [Number(await tl.getAttribute("data-view-start")), Number(await tl.getAttribute("data-view-end"))] as const;
  await expect(page.getByTestId("editor-scrollbar")).toHaveCount(0);
  for (let i = 0; i < 3; i++) await page.getByTestId("editor-zoom-in").click();
  const [s0, e0] = await view();
  expect(e0 - s0).toBeLessThan(1.5);
  await expect(page.getByTestId("editor-scrollbar")).toBeVisible();
  const now = async () => Number((await page.getByTestId("editor-time").textContent())!.split(":")[1]!.split(" ")[0]);
  await page.getByTestId("editor-play").click();
  // It turns the page as the playhead runs off it.
  await expect.poll(async () => (await view())[0], { timeout: 10_000 }).toBeGreaterThan(0.5);
  // Back to the start with the scrollbar, while still playing: it stays there.
  const bar = (await page.getByTestId("editor-scrollbar").boundingBox())!;
  await page.mouse.click(bar.x + 2, bar.y + bar.height / 2);
  expect((await view())[0]).toBe(0);
  const t1 = await now();
  await page.waitForTimeout(1500);
  expect((await view())[0]).toBe(0);
  expect(await now()).toBeGreaterThan(t1 + 0.5); // still playing
  // The far end, by dragging the thumb.
  const thumb = (await page.getByTestId("editor-scroll-thumb").boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width + 20, thumb.y + thumb.height / 2, { steps: 5 });
  await page.mouse.up();
  const [s2, e2] = await view();
  expect(e2).toBeCloseTo(Number(await tl.getAttribute("data-span")), 3);
  expect(s2).toBeGreaterThan(0);
  await page.getByTestId("editor-play").click();
});

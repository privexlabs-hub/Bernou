import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { audioStats, countVideoFrames, fileInfo, loadRecording, loadRecordingBytes, pixelAt, toneLevels } from "./recordingProbe";
import { decodeColour, exportVideo, installFakeSource, originalBytes, readOriginal, recordAndOpenEditor, select } from "./editorHelpers";

test.skip(({ browserName }) => browserName !== "chromium", "the media tests run on Chromium");
test.setTimeout(240_000);

/** The original-clock time shown at output time t, read from the middle of the frame. */
const codeAt = async (page: Page, t: number) => decodeColour(await pixelAt(page, t, 0.5, 0.5));

/** Original recording time → the fake source's clock, found from the original file. */
async function sourceOffset(page: Page): Promise<number> {
  const codes: number[] = [];
  for (const t of [0.5, 1.0, 1.5]) {
    const c = await codeAt(page, t);
    if (c !== null) codes.push(c - t);
  }
  codes.sort((a, b) => a - b);
  return codes[Math.floor(codes.length / 2)]!;
}

test("opens from the finished dialog, with the recording's length and its waveform", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  const d = Number(await page.getByTestId("editor").getAttribute("data-duration"));
  expect(d).toBeGreaterThan(3.5);
  expect(d).toBeLessThan(6);
  await expect(page.getByTestId("editor-timeline")).toBeVisible();
});

test("removing 2–4 s: the export is 2 s shorter and skips exactly that time", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 9);
  const before = Number(await page.getByTestId("editor").getAttribute("data-duration"));
  await select(page, 2, 4);
  await page.getByTestId("editor-remove").click();
  await expect(page.getByTestId("editor-cut")).toHaveCount(1);
  expect(Number(await page.getByTestId("editor").getAttribute("data-duration"))).toBeCloseTo(before - 2, 2);

  const dl = await exportVideo(page);
  const bytes = await loadRecording(page, dl);
  expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  expect(bytes.includes(Buffer.from("moof"))).toBe(false); // one plain MP4, so QuickTime stays in sync
  const info = await fileInfo(page);
  expect(Math.abs(info.duration - (before - 2))).toBeLessThan(0.1);
  expect(Math.abs(countVideoFrames(bytes) - Math.round((before - 2) * 30))).toBeLessThanOrEqual(1);

  const offset = await sourceOffset(page);
  // Before the cut, output time = original time; after it, original time = output + 2.
  for (const [out, orig] of [[1.0, 1.0], [1.9, 1.9], [2.1, 4.1], [4.0, 6.0]] as const) {
    const c = await codeAt(page, out);
    expect(c, `frame at ${out} s`).not.toBeNull();
    expect(Math.abs(c! - offset - orig), `frame at ${out} s shows original ${c! - offset}`).toBeLessThan(0.06);
  }
});

const editorDuration = async (page: Page) => Number(await page.getByTestId("editor").getAttribute("data-duration"));

/** Loads the original into the probe and returns the source-clock offset. */
async function probeOriginal(page: Page): Promise<number> {
  await loadRecordingBytes(page, await readOriginal(page), "original.mp4");
  return sourceOffset(page);
}

/** Times of white flashes in the probed file, scanning every frame. */
async function flashTimes(page: Page, duration: number): Promise<number[]> {
  const out: number[] = [];
  let inFlash = false;
  for (let t = 0.02; t < duration - 0.02; t += 1 / 30) {
    const [r, g, b] = await pixelAt(page, t, 0.5, 0.5);
    const white = r! > 235 && g! > 235 && b! > 235;
    if (white && !inFlash) out.push(t);
    inFlash = white;
  }
  return out;
}

/** Leading edges of the clicks in the probed file's audio. */
const clickTimes = (page: Page) =>
  page.evaluate(() => {
    const a = (window as unknown as { __probe: { audio: AudioBuffer | null } }).__probe.audio!;
    const d = a.getChannelData(0);
    const out: number[] = [];
    let last = -1;
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]!) > 0.55 && i / a.sampleRate - last > 0.3) {
        out.push(i / a.sampleRate);
        last = i / a.sampleRate;
      }
    }
    return out;
  });

test("a cut starting inside a hold in the original shows the held frame up to the cut, then the frame after it", async ({ page }) => {
  await installFakeSource(page, { hold: [4.5, 5.7] });
  await recordAndOpenEditor(page, 9);
  const offset = await probeOriginal(page);
  const holdStart = 4.5 - offset; // original time
  const cut = { start: holdStart + 0.6, end: holdStart + 2.0 };
  await select(page, cut.start, cut.end);
  await page.getByTestId("editor-remove").click();
  const bytes = await loadRecording(page, await exportVideo(page));
  expect(countVideoFrames(bytes)).toBeGreaterThan(0);
  const before = await codeAt(page, cut.start - 0.05);
  expect(before, "just before the cut, the held frame").not.toBeNull();
  expect(Math.abs(before! - 4.5)).toBeLessThan(0.06); // the frame on screen during the hold, not one from after it
  const after = await codeAt(page, cut.start + 0.05);
  expect(Math.abs(after! - offset - (cut.end + 0.05))).toBeLessThan(0.06);
});

test("sound and picture stay together across joins", async ({ page }) => {
  const flashes = [2.2, 4.4, 6.6, 8.8];
  await installFakeSource(page, { flashes });
  await recordAndOpenEditor(page, 10.5);
  const offset = await probeOriginal(page);
  const dOrig = (await fileInfo(page)).duration;
  const origFlash = await flashTimes(page, dOrig);
  const origClick = await clickTimes(page);
  expect(origFlash.length).toBe(origClick.length);
  const origSkew = origClick.map((c, i) => c - origFlash[i]!);
  // Two cuts between flashes.
  await select(page, 3.0 - offset, 3.6 - offset);
  await page.getByTestId("editor-remove").click();
  await select(page, 7.0 - offset, 7.6 - offset);
  await page.getByTestId("editor-remove").click();
  await loadRecording(page, await exportVideo(page));
  const d = (await fileInfo(page)).duration;
  const f = await flashTimes(page, d);
  const c = await clickTimes(page);
  expect(f.length, "every flash survives").toBe(origFlash.length);
  expect(c.length, "every click survives").toBe(origFlash.length);
  // Audio minus video, in seconds: positive means the sound comes late. Compared with the original's own.
  const skew = c.map((t, i) => t - f[i]!);
  console.log("original skew ms", origSkew.map((x) => Math.round(x * 1000)), "export skew ms", skew.map((x) => Math.round(x * 1000)));
  for (let i = 0; i < skew.length; i++) expect(Math.abs(skew[i]! - origSkew[i]!), `flash ${i + 1}`).toBeLessThan(0.04);
});

test("trimming by dragging the handles", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 7);
  const offset = await probeOriginal(page);
  const before = await editorDuration(page);
  const box = (await page.getByTestId("editor-timeline").boundingBox())!;
  const xAt = (t: number) => box.x + (t / before) * box.width;
  const y = box.y + 30;
  for (const [from, to] of [[0, 1], [before, before - 1]] as const) {
    await page.mouse.move(xAt(from) + (from === 0 ? 2 : -2), y);
    await page.mouse.down();
    await page.mouse.move(xAt(to), y, { steps: 5 });
    await page.mouse.up();
  }
  expect(Math.abs((await editorDuration(page)) - (before - 2))).toBeLessThan(0.1);
  await loadRecording(page, await exportVideo(page));
  expect(Math.abs((await fileInfo(page)).duration - (before - 2))).toBeLessThan(0.15);
  const first = await codeAt(page, 0.05);
  expect(Math.abs(first! - offset - 1.05)).toBeLessThan(0.1);
});

test("smooth joins crossfade the picture, and the output is half a second shorter", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 8);
  const before = await editorDuration(page);
  await select(page, 2, 5);
  await page.getByTestId("editor-remove").click();
  await page.getByTestId("editor-smooth-joins").click();
  expect(Math.abs((await editorDuration(page)) - (before - 3.5))).toBeLessThan(0.01);
  await loadRecording(page, await exportVideo(page));
  expect(Math.abs((await fileInfo(page)).duration - (before - 3.5))).toBeLessThan(0.1);
  // The join runs from output 1.5 to 2.0. Halfway, the picture is a mix of both sides.
  const [a] = await pixelAt(page, 1.3, 0.5, 0.5); // before: about original 1.3
  const [b] = await pixelAt(page, 2.2, 0.5, 0.5); // after: about original 5.7
  const [mid] = await pixelAt(page, 1.75, 0.5, 0.5);
  expect(mid!).toBeGreaterThan(Math.min(a!, b!) + 10);
  expect(mid!).toBeLessThan(Math.max(a!, b!) - 10);
});

test("volume, a muted section and audio-only download", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 7);
  await loadRecordingBytes(page, await readOriginal(page), "original.mp4");
  const [origLevel] = await toneLevels(page, 1, 3, [1000]);
  // -6 dB, by keyboard on the slider.
  await page.getByTestId("editor-tab-audio").click();
  const vol = page.getByTestId("editor-volume").getByRole("slider");
  await vol.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("editor-volume-value")).toHaveText("-6 dB");
  await select(page, 4, 5);
  await page.getByTestId("editor-mute").click();

  await loadRecording(page, await exportVideo(page));
  const [level] = await toneLevels(page, 1, 3, [1000]);
  expect(Math.abs(level! - origLevel! + 6), `tone ${level} against ${origLevel}`).toBeLessThan(0.5);
  expect((await audioStats(page, 4.05, 4.95)).rms).toBeLessThan(0.002);
  expect((await audioStats(page, 5.2, 6)).rms).toBeGreaterThan(0.03);

  await page.getByTestId("editor-export-done").getByRole("button", { name: "Done" }).click();
  const wavDl = page.waitForEvent("download");
  await page.getByTestId("editor-audio-only").click();
  const wav = await readFile(await (await wavDl).path());
  expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
  const rate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const frames = wav.readUInt32LE(40) / (2 * channels);
  expect(rate).toBe(48000);
  expect(Math.abs(frames / rate - (await editorDuration(page)))).toBeLessThan(0.05);
});

test("noise removal takes out the noise between phrases and keeps the speech", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 10);
  const offset = await probeOriginal(page);
  // Speech from source 1 s for the phrase's length, then 1.5 s of noise only, repeating.
  const phrase = await page.evaluate(async () => (await new AudioContext().decodeAudioData(await (await fetch("/__fixture/speech.wav")).arrayBuffer())).duration);
  const gap = { start: 1 + phrase + 0.25 - offset, end: 1 + phrase + 1.25 - offset };
  const speech = { start: 1.3 - offset, end: 1 + phrase - 0.3 - offset };
  const noisyGap = (await audioStats(page, gap.start, gap.end)).rms;
  const noisySpeech = (await audioStats(page, speech.start, speech.end)).rms;

  await page.getByTestId("editor-tab-audio").click();
  await page.getByTestId("editor-denoise").click();
  await loadRecording(page, await exportVideo(page));
  const cleanGap = (await audioStats(page, gap.start, gap.end)).rms;
  const cleanSpeech = (await audioStats(page, speech.start, speech.end)).rms;
  const db = (x: number) => 20 * Math.log10(x);
  console.log("gap dB", db(noisyGap).toFixed(1), "→", db(cleanGap).toFixed(1), "speech dB", db(noisySpeech).toFixed(1), "→", db(cleanSpeech).toFixed(1));
  expect(db(cleanGap)).toBeLessThan(db(noisyGap) - 10);
  expect(Math.abs(db(cleanSpeech) - db(noisySpeech))).toBeLessThan(3);
});

test("text and a highlight appear in the export only during their times, where they were placed", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 7);
  await select(page, 1, 3);
  await page.getByTestId("editor-add-text").click();
  await page.getByTestId("editor-overlay-text").fill("Hello");
  await select(page, 4, 6);
  await page.getByTestId("editor-add-highlight").click();
  await loadRecording(page, await exportVideo(page));
  const dark = async (t: number) => {
    const inBox = await pixelAt(page, t, 0.085, 0.79); // inside the text's backing box, left of the text
    const plain = await pixelAt(page, t, 0.5, 0.5);
    return (inBox[0]! + inBox[1]! + inBox[2]!) / Math.max(1, plain[0]! + plain[1]! + plain[2]!);
  };
  expect(await dark(2)).toBeLessThan(0.7);
  expect(await dark(0.5)).toBeGreaterThan(0.85);
  expect(await dark(3.5)).toBeGreaterThan(0.85);
  // The highlight's outline: amber on its left edge, at x 0.35, only from 4 to 6.
  const amber = async (t: number) => {
    const [r, g, b] = await pixelAt(page, t, 0.35, 0.45);
    return r! > 200 && g! > 120 && g! < 200 && b! < 80;
  };
  expect(await amber(5)).toBe(true);
  expect(await amber(3)).toBe(false);
});

test("brightness raises the picture by the set amount, and reset leaves it as it was", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 6);
  await loadRecordingBytes(page, await readOriginal(page), "original.mp4");
  const orig = await pixelAt(page, 2, 0.5, 0.5);
  await page.getByTestId("editor-tab-picture").click();
  const s = page.getByTestId("editor-brightness").getByRole("slider");
  await s.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("editor-brightness-value")).toHaveText("+30");
  await loadRecording(page, await exportVideo(page));
  const bright = await pixelAt(page, 2, 0.5, 0.5);
  for (let c = 0; c < 3; c++) if (orig[c]! > 30) expect(Math.abs(bright[c]! - Math.min(255, orig[c]! * 1.3)), `channel ${c}`).toBeLessThan(14);

  await page.getByTestId("editor-export-done").getByRole("button", { name: "Done" }).click();
  await page.getByTestId("editor-picture-reset").click();
  await loadRecording(page, await exportVideo(page));
  const reset = await pixelAt(page, 2, 0.5, 0.5);
  for (let c = 0; c < 3; c++) expect(Math.abs(reset[c]! - orig[c]!)).toBeLessThan(8);
});

test("export saves a new recording marked as edited, and leaves the original untouched", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  const before = await originalBytes(page);
  await select(page, 1, 2);
  await page.getByTestId("editor-remove").click();
  await exportVideo(page);
  const after = await originalBytes(page);
  // Everything that was there is still there, byte for byte; one file was added.
  for (const f of before.split("|")) expect(after).toContain(f);
  expect(after.split("|").length).toBe(before.split("|").length + 1);
  await page.getByTestId("editor-export-done").getByRole("button", { name: "Done" }).click();
  await page.getByTestId("editor-back").click();
  await expect(page.getByTestId("recording-row")).toHaveCount(2);
  await expect(page.getByTestId("recording-row").filter({ hasText: "(edited)" })).toContainText("Edited");
});

test("cancelling an export leaves no file and no recording", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 8);
  const before = await originalBytes(page);
  await page.getByTestId("editor-export").click();
  await expect(page.getByTestId("editor-export-progress")).toBeVisible();
  await page.getByTestId("editor-export-cancel").click();
  await expect(page.getByTestId("editor-export-cancelled")).toBeVisible({ timeout: 30_000 });
  expect(await originalBytes(page)).toBe(before);
  await page.getByTestId("editor-export-cancelled").getByRole("button", { name: "Close" }).click();
  await page.getByTestId("editor-back").click();
  await expect(page.getByTestId("recording-row")).toHaveCount(1);
});

test("undo and redo, the project kept across a reload, and Revert all", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 6);
  const full = await editorDuration(page);
  await select(page, 1, 2);
  await page.getByTestId("editor-remove").click();
  await page.getByTestId("editor-tab-cuts").click();
  await page.getByTestId("editor-smooth-joins").click();
  expect(await editorDuration(page)).toBeCloseTo(full - 1.5, 2);
  await page.getByTestId("editor-undo").click();
  expect(await editorDuration(page)).toBeCloseTo(full - 1, 2);
  await page.keyboard.press("Meta+z");
  expect(await editorDuration(page)).toBeCloseTo(full, 2);
  await page.keyboard.press("Meta+Shift+z");
  expect(await editorDuration(page)).toBeCloseTo(full - 1, 2);

  await page.waitForTimeout(800); // past the autosave
  await page.reload();
  await expect(page.getByTestId("editor")).toBeVisible({ timeout: 30_000 });
  expect(await editorDuration(page)).toBeCloseTo(full - 1, 2);
  await expect(page.getByTestId("editor-cut")).toHaveCount(1);

  await page.getByTestId("editor-revert").click();
  expect(await editorDuration(page)).toBeCloseTo(full, 2);
  await page.getByTestId("editor-undo").click(); // Revert all is itself undoable
  expect(await editorDuration(page)).toBeCloseTo(full - 1, 2);
});

test("typing in a text box doesn't trigger the editor's keys", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  await select(page, 1, 2);
  await page.getByTestId("editor-add-text").click();
  const box = page.getByTestId("editor-overlay-text");
  await box.fill("");
  await box.type("io  oi");
  await expect(box).toHaveValue("io  oi");
  await expect(page.getByTestId("editor-play")).toHaveAttribute("aria-label", "Play");
});

test("opens from the dashboard too", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 3);
  await page.getByTestId("editor-back").click();
  await page.getByTestId("recording-row-edit").click();
  await expect(page.getByTestId("editor")).toBeVisible({ timeout: 30_000 });
});

test("the preview draws text in the same place and at the same times as the export", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 6);
  await select(page, 1, 3);
  await page.getByTestId("editor-add-text").click();
  const d = await editorDuration(page);
  const box = (await page.getByTestId("editor-timeline").boundingBox())!;
  const seekTo = async (t: number) => {
    await page.mouse.click(box.x + (t / d) * box.width, box.y + 30);
    await expect.poll(async () => Number((await page.getByTestId("editor-time").textContent())!.split(":")[1]!.split(" ")[0])).toBeCloseTo(t, 0);
  };
  // Alpha of the overlay canvas inside the text's backing box (same fractions the export test samples).
  const alphaAt = () =>
    page.getByTestId("editor-overlay-canvas").evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(Math.round(0.085 * c.width), Math.round(0.79 * c.height), 1, 1).data[3]!);
  await seekTo(2);
  expect(await alphaAt()).toBeGreaterThan(100);
  await seekTo(4);
  expect(await alphaAt()).toBe(0);
});

test("a 60-second export with cuts and a hold has every frame, in time", async ({ page }) => {
  test.setTimeout(420_000);
  await installFakeSource(page, { hold: [20, 21.2] });
  await recordAndOpenEditor(page, 60);
  const before = await editorDuration(page);
  await select(page, 10, 12);
  await page.getByTestId("editor-remove").click();
  await select(page, 40, 43);
  await page.getByTestId("editor-remove").click();
  const bytes = await loadRecording(page, await exportVideo(page));
  const expected = before - 5;
  expect(Math.abs((await fileInfo(page)).duration - expected)).toBeLessThan(0.1);
  expect(Math.abs(countVideoFrames(bytes) - Math.round(expected * 30))).toBeLessThanOrEqual(1);
  expect((await fileInfo(page)).audioSeconds).toBeGreaterThan(expected - 0.1);
});

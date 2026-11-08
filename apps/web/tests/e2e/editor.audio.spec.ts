import { expect, test, type Page } from "@playwright/test";
import { audioStats, fileInfo, loadRecording, loadRecordingBytes, pixelAt, toneLevels } from "./recordingProbe";
import { addTone, exportVideo, findSpeechAndPause, installFakeSource, readOriginal, recordAndOpenEditor, select } from "./editorHelpers";

test.skip(({ browserName }) => browserName !== "chromium", "the media tests run on Chromium");
test.setTimeout(300_000);

const editorDuration = async (page: Page) => Number(await page.getByTestId("editor").getAttribute("data-duration"));

/** Onsets of the clicks in the probed file's audio, to the sample. */
const clickTimes = (page: Page) =>
  page.evaluate(() => {
    const a = (window as unknown as { __probe: { audio: AudioBuffer | null } }).__probe.audio!;
    const d = a.getChannelData(0);
    const out: number[] = [];
    let last = -1;
    for (let i = 0; i < d.length; i++) {
      const t = i / a.sampleRate;
      if (Math.abs(d[i]!) > 0.55 && t - last > 0.3) {
        out.push(t);
        last = t;
      }
    }
    return out;
  });

/** Times of white flashes, scanning every frame. */
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

const hasSoundTrack = (bytes: Buffer) => bytes.includes(Buffer.from("soun"));


test("a 3 ms cut removes exactly 3 ms of sound, with no click", async ({ page }) => {
  await installFakeSource(page, { flashes: [1.5, 5] });
  await recordAndOpenEditor(page, 7);
  await loadRecordingBytes(page, await readOriginal(page), "original.mp4");
  const [c1, c2] = await clickTimes(page);
  const cutAt = (c1! + c2!) / 2;
  await select(page, cutAt, cutAt + 0.003);
  await expect(page.getByTestId("editor-sel-length")).toHaveText("3.000 ms");
  await page.getByTestId("editor-remove").click();
  // Smooth joins on: less than a second was cut, so this join stays sharp, and still 3 ms.
  await page.getByTestId("editor-tab-cuts").click();
  await page.getByTestId("editor-smooth-joins").click();
  await loadRecording(page, await exportVideo(page));
  const [e1, e2] = await clickTimes(page);
  // The clicks either side of the cut come 3 ms closer together, to well under a millisecond.
  expect(Math.abs(e2! - e1! - (c2! - c1! - 0.003))).toBeLessThan(0.0005);
  // No click at the join: the tone's own steepest step is about 0.03 a sample.
  const worst = await page.evaluate((t) => {
    const a = (window as unknown as { __probe: { audio: AudioBuffer } }).__probe.audio;
    const d = a.getChannelData(0);
    let w = 0;
    for (let i = Math.floor((t - 0.01) * a.sampleRate); i < (t + 0.01) * a.sampleRate; i++) w = Math.max(w, Math.abs(d[i + 1]! - d[i]!));
    return w;
  }, cutAt - (c1! - e1!));
  expect(worst).toBeLessThan(0.1);
});

test("zooming in to a few milliseconds, and selecting to the microsecond", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  const tl = page.getByTestId("editor-timeline");
  const box = (await tl.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
  }
  const span = Number(await tl.getAttribute("data-view-end")) - Number(await tl.getAttribute("data-view-start"));
  expect(span).toBeLessThan(0.02);
  expect(span).toBeGreaterThanOrEqual(0.005 - 1e-9);
  await expect(page.getByTestId("editor-zoom-span")).toContainText("ms shown");
  await select(page, 1.000125, 1.000375);
  await expect(page.getByTestId("editor-sel-start")).toHaveValue("1.000125");
  await expect(page.getByTestId("editor-sel-length")).toHaveText("0.250 ms");
  await page.getByTestId("editor-zoom-fit").click();
  expect(Number(await tl.getAttribute("data-view-start"))).toBe(0);
});

test("silences: found on their own, reviewed, removed in one step, and undone in one", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 12);
  const before = await editorDuration(page);
  await page.getByTestId("editor-tab-silences").click();
  await expect(page.getByTestId("editor-silence-summary")).toContainText("found");
  const n = await page.getByTestId("editor-silence-item").count();
  expect(n).toBeGreaterThanOrEqual(2); // the gaps between phrases
  const total = Number((await page.getByTestId("editor-silence-summary").textContent())!.match(/([\d.]+) s in all/)![1]);
  await page.getByTestId("editor-silence-remove-all").click();
  expect(await editorDuration(page)).toBeCloseTo(before - total, 1);
  await page.getByTestId("editor-tab-cuts").click();
  expect(await page.getByTestId("editor-cut").count()).toBe(n);
  await page.getByTestId("editor-undo").click();
  expect(await editorDuration(page)).toBeCloseTo(before, 3);
});

test("the recording's sound switched off: the export has no sound track", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  await page.getByTestId("editor-tab-audio").click();
  await page.getByTestId("editor-original-on").click();
  const bytes = await loadRecording(page, await exportVideo(page));
  expect(hasSoundTrack(bytes)).toBe(false);
  expect((await fileInfo(page)).duration).toBeGreaterThan(3);
});

test("shifting the sound 200 ms later moves every click 200 ms against its flash", async ({ page }) => {
  await installFakeSource(page, { flashes: [1.5, 3.5, 5.5] });
  await recordAndOpenEditor(page, 7);
  await loadRecordingBytes(page, await readOriginal(page), "original.mp4");
  const dOrig = (await fileInfo(page)).duration;
  const of = await flashTimes(page, dOrig);
  const oc = await clickTimes(page);
  await page.getByTestId("editor-tab-audio").click();
  await page.getByTestId("editor-original-offset").fill("200");
  await loadRecording(page, await exportVideo(page));
  const f = await flashTimes(page, (await fileInfo(page)).duration);
  const c = await clickTimes(page);
  expect(f.length).toBe(of.length);
  expect(c.length).toBe(oc.length);
  for (let i = 0; i < f.length; i++) expect(Math.abs(c[i]! - f[i]! - (oc[i]! - of[i]! + 0.2)), `flash ${i + 1}`).toBeLessThan(0.04);
});

test("added music: there from its start, at its volume, looping to the end, fading in", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 8);
  await addTone(page, "music", 500, 2);
  await page.getByTestId("editor-track-loop").click();
  await page.getByTestId("editor-track-duck").click(); // off: this test is about the track itself
  const d = await editorDuration(page);
  await loadRecording(page, await exportVideo(page));
  const at = async (from: number) => (await toneLevels(page, from, from + 0.5, [500]))[0]!;
  // The file is a sine at 0.5 (-6 dBFS); music comes in at -12 dB: about -18 dBFS once faded in.
  expect(Math.abs((await at(2.2)) + 18)).toBeLessThan(1.5);
  expect(await at(0.1)).toBeLessThan((await at(2.2)) - 6); // still fading in (1 s)
  expect(Math.abs((await at(d - 2.9)) + 18)).toBeLessThan(1.5); // looped well past the 2 s file
  // The recording's own 1 kHz tone is still there under it.
  expect((await toneLevels(page, 2.2, 2.7, [1000]))[0]!).toBeGreaterThan(-25);
});

test("music dips while someone speaks and comes back up in the pauses", async ({ page }) => {
  await installFakeSource(page, { speech: true });
  await recordAndOpenEditor(page, 12);
  await loadRecordingBytes(page, await readOriginal(page), "original.mp4");
  const { speech: speechAt, pause: gapAt } = await findSpeechAndPause(page);
  await addTone(page, "music", 500, 20);
  await page.getByTestId("editor-track-volume").getByRole("slider").focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight"); // back to 0 dB, so the tone stands clear of the speech
  await loadRecording(page, await exportVideo(page));
  const [inSpeech] = await toneLevels(page, speechAt, speechAt + 0.3, [500]);
  const [inGap] = await toneLevels(page, gapAt, gapAt + 0.3, [500]);
  console.log("500 Hz in speech", inSpeech!.toFixed(1), "in a pause", inGap!.toFixed(1));
  expect(inGap! - inSpeech!).toBeGreaterThan(8); // the dip is 12 dB, less the time it takes to move
});

test("replacing the voice: the export's sound is the file, and the recording's is gone", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 5);
  await addTone(page, "voice", 500, 6);
  await expect(page.getByTestId("editor-original-on")).toHaveAttribute("data-state", "unchecked");
  await loadRecording(page, await exportVideo(page));
  const [t500, t1k] = await toneLevels(page, 1, 3, [500, 1000]);
  expect(t500!).toBeGreaterThan(-9); // the file, at 0 dB
  expect(t1k!).toBeLessThan(-50); // the recording's own tone, gone
});

test("tracks survive a reload, and their files go when the recording is deleted", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  await addTone(page, "music", 500, 2);
  await page.waitForTimeout(800); // past the autosave
  await page.reload();
  await expect(page.getByTestId("editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("editor-tab-audio").click();
  await expect(page.getByTestId("editor-track-item")).toHaveCount(1);
  const files = () =>
    page.evaluate(async () => {
      try {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("editor-audio");
        let n = 0;
        for await (const [, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemDirectoryHandle]> }).entries()) for await (const _ of (h as unknown as { entries(): AsyncIterable<unknown> }).entries()) n++;
        return n;
      } catch {
        return 0;
      }
    });
  expect(await files()).toBe(1);
  await page.getByTestId("editor-back").click();
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("recording-row-delete").first().click();
  await expect(page.getByTestId("recording-row")).toHaveCount(0);
  expect(await files()).toBe(0);
});

test("audio-only download with the recording sound off and music added is the music", async ({ page }) => {
  await installFakeSource(page);
  await recordAndOpenEditor(page, 4);
  await page.getByTestId("editor-tab-audio").click();
  await page.getByTestId("editor-original-on").click();
  await addTone(page, "music", 500, 6);
  const dl = page.waitForEvent("download");
  await page.getByTestId("editor-audio-only").click();
  const { readFile } = await import("node:fs/promises");
  const wav = await readFile(await (await dl).path());
  expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(wav.readUInt32LE(40)).toBeGreaterThan(0);
});

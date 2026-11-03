import { expect, test, type Download, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";
import { audioStats, countVideoFrames, fileInfo, loadRecording, pixelAt, regionChecksum, seekTimes, silenceStart } from "./recordingProbe";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));
const SCRIPT_CANARY = "CANARY-SCRIPT-REC-41";
const NOTES_CANARY = "CANARY-NOTES-REC-77";
const TITLE_CANARY = "CANARY-TITLE-REC-13";
const BAR: [number, number] = [0.2, 0.05]; // the deck's per-slide colour band
const MUTED = 0.002;

test.skip(({ browserName }) => browserName !== "chromium", "fake devices are Chromium flags");
test.setTimeout(90_000);

async function studio(page: Page) {
  const id = await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  return id;
}

const previewPixel = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(x! * c.width), Math.round(y! * c.height), 1, 1).data.slice(0, 3));
    },
    [x, y],
  );

/** Colourfulness of the camera overlay. Several points: the fixture has a moving white square. */
async function overlaySaturation(page: Page, t: number): Promise<number> {
  let most = 0;
  for (const [x, y] of [[0.85, 0.75], [0.87, 0.82], [0.9, 0.85], [0.82, 0.8], [0.87, 0.9]] as const) {
    const [r, g, b] = await pixelAt(page, t, x, y);
    most = Math.max(most, Math.max(r!, g!, b!) - Math.min(r!, g!, b!));
  }
  return most;
}

const near = (a: number[], b: number[], tolerance: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

async function micOn(page: Page) {
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "true");
}

async function startRecording(page: Page) {
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
}

async function stopAndDownload(page: Page): Promise<Download> {
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("recording-finished")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("recording-download")).toBeEnabled();
  const dl = page.waitForEvent("download");
  await page.getByTestId("recording-download").click();
  return dl;
}

const rows = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ id: string; status?: string; bytes: number; durationMs: number; opfsPath: string; title: string }>>((resolve) => {
        const open = indexedDB.open("bernou");
        open.onsuccess = () => {
          const q = open.result.transaction("recordings").objectStore("recordings").getAll();
          q.onsuccess = () => {
            open.result.close();
            resolve(q.result);
          };
        };
      }),
  );

const opfsFiles = (page: Page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      const dir = await root.getDirectoryHandle("recordings");
      const names: string[] = [];
      for await (const n of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(n);
      return names;
    } catch {
      return [];
    }
  });

test("a recording with camera and voice downloads exactly as presented", async ({ page }) => {
  await studio(page);
  await page.getByLabel("Presentation title (private)").fill(TITLE_CANARY);
  await page.getByLabel("Presentation title (private)").blur();
  await page.getByTestId("script-paste").fill(`Private script ${SCRIPT_CANARY}`);
  await page.getByTestId("script-paste-commit").click();
  await page.getByTestId("tab-notes").click();
  await page.getByTestId("notes-body").fill(`Private note ${NOTES_CANARY}`);

  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  await micOn(page);
  await expect(page.getByTestId("indicator-recording")).toHaveAttribute("data-on", "false");

  await startRecording(page);
  const t0 = Date.now();
  await expect(page.getByTestId("indicator-recording")).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("record-timer")).toBeVisible();

  const slides: Array<{ at: number; color: number[] }> = [];
  const note = async () => {
    await page.waitForTimeout(250);
    slides.push({ at: (Date.now() - t0) / 1000, color: await previewPixel(page, ...BAR) });
  };
  await note();
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(2500);
    await page.getByTestId("slide-next").click();
    await note();
  }
  await page.waitForTimeout(2000);

  // Mute and change slide in the same moment: the file must keep them together.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-testid="mic-mute"]')!.click();
    document.querySelector<HTMLElement>('[data-testid="slide-next"]')!.click();
  });
  const mutedAt = (Date.now() - t0) / 1000;
  await note();
  await page.waitForTimeout(2500);
  await page.getByTestId("mic-mute").click();
  const unmutedAt = (Date.now() - t0) / 1000;
  await page.waitForTimeout(2500);

  const wall = (Date.now() - t0) / 1000;
  const dl = await stopAndDownload(page);
  expect(dl.suggestedFilename()).toMatch(new RegExp(`^${TITLE_CANARY}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.(mp4|webm)$`));

  await expect(page.getByTestId("recording-playback")).toBeVisible();
  const bytes = await loadRecording(page, dl);

  // File: the audience output's size, a real duration without tricks, seekable.
  const info = await fileInfo(page);
  expect([info.width, info.height]).toEqual([1920, 1080]);
  expect(Number.isFinite(info.duration)).toBe(true);
  // The app's own clock, since the test only sees recording begin a moment after it does.
  const [saved] = await rows(page);
  expect(info.duration).toBeGreaterThan((saved!.durationMs / 1000) * 0.97);
  expect(info.duration).toBeLessThan((saved!.durationMs / 1000) * 1.03);
  const late = Math.max(0, info.duration - wall);
  expect(late).toBeLessThan(2.5);
  expect(info.audioSeconds).toBeGreaterThan(info.duration * 0.9);
  for (const ms of await seekTimes(page, [0.1, 0.9, 0.5, 0.2, 0.7].map((f) => f * info.duration))) {
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(2000);
  }

  // Video: what was on screen at each moment, not just at the end.
  for (let i = 0; i < slides.length; i++) {
    const end = slides[i + 1]?.at ?? wall;
    const mid = (slides[i]!.at + end) / 2 + late;
    expect(near(await pixelAt(page, mid, ...BAR), slides[i]!.color, 40), `slide ${i} colour at ${mid}s`).toBe(true);
  }
  // Camera: the fixture's saturated pattern in the overlay, changing through the file.
  const overlay = new Set<string>(); // the camera moves
  for (let i = 1; i <= 6; i++) {
    const t = (i / 7) * info.duration;
    expect(await overlaySaturation(page, t)).toBeGreaterThan(40);
    overlay.add(String(await regionChecksum(page, t, [0.8, 0.7, 0.14, 0.24])));
  }
  expect(overlay.size).toBeGreaterThan(1);

  // Voice: the fake mic's 440 Hz tone, silence while muted, and back afterwards.
  const fileMutedAt = mutedAt + late;
  const fileUnmutedAt = unmutedAt + late;
  const voiced = await audioStats(page, 1, fileMutedAt - 1);
  expect(voiced.rms).toBeGreaterThan(0.01);
  expect(voiced.tone).toBeGreaterThan(voiced.rms * 0.5);
  expect((await audioStats(page, fileMutedAt + 0.8, fileUnmutedAt - 0.8)).rms).toBeLessThan(MUTED);
  expect((await audioStats(page, fileUnmutedAt + 0.8, info.duration - 0.2)).rms).toBeGreaterThan(0.01);

  // Sync: the mute and the slide change landed together in the file.
  const silence = await silenceStart(page, fileMutedAt - 2, fileMutedAt + 2, MUTED);
  expect(silence).not.toBeNull();
  const before = slides[slides.length - 2]!.color;
  let change: number | null = null;
  for (let t = Math.max(0, fileMutedAt - 2); t < fileMutedAt + 2; t += 0.05) {
    if (!near(await pixelAt(page, t, ...BAR), before, 40)) {
      change = t;
      break;
    }
  }
  expect(change).not.toBeNull();
  expect(Math.abs(change! - silence!)).toBeLessThan(0.35);

  // Privacy: none of the presenter's private text is in the file.
  const text = bytes.toString("latin1");
  for (const canary of [SCRIPT_CANARY, NOTES_CANARY, TITLE_CANARY, "cam.y4m", "tone.wav", "Fake"]) expect(text).not.toContain(canary);

  // Saved properly, and listed for later.
  const [row] = await rows(page);
  expect(row).toMatchObject({ status: "complete", bytes: bytes.length > 0 ? expect.any(Number) : 0 });
  expect(Math.abs(row!.durationMs / 1000 - info.duration)).toBeLessThan(1.5);
  await page.keyboard.press("Escape");
  await page.getByTestId("back-to-dashboard").click();
  await expect(page.getByTestId("recording-row")).toHaveCount(1);
  const again = page.waitForEvent("download");
  await page.getByTestId("recording-row-download").click();
  expect((await (await again).path()) && (await again).suggestedFilename()).toBe(dl.suggestedFilename());
});

test("mic off: asks first, and a silent recording keeps a steady frame rate on a still slide", async ({ page }) => {
  await studio(page);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("record-mic-prompt")).toBeVisible();
  await page.getByTestId("record-without-voice").click();
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
  await page.waitForTimeout(6000);
  const dl = await stopAndDownload(page);
  const bytes = await loadRecording(page, dl);
  const info = await fileInfo(page);
  expect(info.duration).toBeGreaterThan(5);
  expect(info.audioSeconds).toBeGreaterThan(4);
  expect((await audioStats(page, 0.5, info.duration - 0.2)).rms).toBeLessThan(MUTED);
  // No camera and nothing changing: the canvas isn't redrawn at all.
  // Playwright's headless build has no GPU, so 1080p sheds frames there. Real Chrome measured 30.
  const minFps = process.env.PW_CHROME_CHANNEL ? 20 : 15;
  expect(countVideoFrames(bytes) / info.duration).toBeGreaterThanOrEqual(minFps);
});

test("turn on mic and record starts both", async ({ page }) => {
  await studio(page);
  await page.getByTestId("record-toggle").click();
  await page.getByTestId("record-with-mic").click();
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
  await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "true");
  await page.waitForTimeout(3000);
  await loadRecording(page, await stopAndDownload(page));
  expect((await audioStats(page, 1, 2.5)).rms).toBeGreaterThan(0.01);
});

test("devices and layout can change during a recording", async ({ page }) => {
  await studio(page);
  await page.getByTestId("record-toggle").click();
  await page.getByTestId("record-without-voice").click();
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
  const t0 = Date.now();
  await page.waitForTimeout(2500);
  const micAt = (Date.now() - t0) / 1000;
  await micOn(page);
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  await page.waitForTimeout(2500);
  const offAt = (Date.now() - t0) / 1000;
  await page.getByTestId("mic-toggle").click();
  await page.getByTestId("camera-toggle").click();
  await page.waitForTimeout(2500);
  await page.getByTestId("tab-camera").click();
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  await page.getByTestId("layout-camera-full").click();
  const fullAt = (Date.now() - t0) / 1000;
  await page.waitForTimeout(2500);

  const wall = (Date.now() - t0) / 1000;
  await loadRecording(page, await stopAndDownload(page));
  const info = await fileInfo(page);
  expect(info.duration).toBeGreaterThan(fullAt);
  const late = Math.max(0, info.duration - wall); // the test sees recording begin a moment after it does
  expect((await audioStats(page, 0.3, micAt + late - 0.3)).rms).toBeLessThan(MUTED);
  expect((await audioStats(page, micAt + late + 1, offAt + late - 0.5)).rms).toBeGreaterThan(0.01);
  expect(await overlaySaturation(page, 0.5)).toBeLessThan(20); // camera off: plain slide
  expect(await overlaySaturation(page, offAt + late - 0.3)).toBeGreaterThan(40); // on
  expect(await overlaySaturation(page, offAt + late + 1.5)).toBeLessThan(20); // off again
});

test("double-clicking Record makes one recording", async ({ page }) => {
  await studio(page);
  await micOn(page);
  await page.getByTestId("record-toggle").dblclick();
  await page.waitForTimeout(1500);
  expect((await rows(page)).length).toBeLessThanOrEqual(1);
});

test("Stop all keeps the recording, without a dialog, and leaves nothing live", async ({ page }) => {
  await studio(page);
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  await micOn(page);
  await startRecording(page);
  await page.waitForTimeout(3000);

  await page.keyboard.press("Control+Shift+Escape");
  await expect(page.getByTestId("stopped-banner")).toContainText("Recording saved", { timeout: 10_000 });
  await expect(page.getByTestId("recording-finished")).toHaveCount(0);
  await expect(page.getByTestId("indicator-recording")).toHaveAttribute("data-on", "false");
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "idle");

  const [row] = await rows(page);
  expect(row!.status).toBe("complete");
  expect(row!.bytes).toBeGreaterThan(0);

  await page.getByTestId("back-to-dashboard").click();
  const dl = page.waitForEvent("download");
  await page.getByTestId("recording-row-download").click();
  await loadRecording(page, await dl);
  const info = await fileInfo(page);
  expect(info.duration).toBeGreaterThan(2);
  // It ends on the live composition: the camera was still there, not a placeholder disc.
  expect(await overlaySaturation(page, Math.max(0, info.duration - 0.2))).toBeGreaterThan(40);
});

test("Stop all while a recording is starting records nothing", async ({ page, context }) => {
  await context.addInitScript(() => {
    const est = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => {
      await new Promise((r) => setTimeout(r, 400));
      return est();
    };
  });
  await studio(page);
  await micOn(page);
  await page.getByTestId("record-toggle").click();
  await page.keyboard.press("Control+Shift+Escape");
  await expect(page.getByTestId("stopped-banner")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "idle");
  expect(await rows(page)).toEqual([]);
  expect(await opfsFiles(page)).toEqual([]);
});

test("you can't walk out of a recording by the back link", async ({ page }) => {
  await studio(page);
  await micOn(page);
  await startRecording(page);
  await page.getByTestId("back-to-dashboard").click({ force: true }); // it's aria-disabled, which Playwright would wait out
  await expect(page).toHaveURL(/\/studio\//);
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
});

test("browser back during a recording still finalises the file", async ({ page }) => {
  await studio(page);
  await micOn(page);
  await startRecording(page);
  await page.waitForTimeout(2000);
  await page.goBack();
  await expect(page.getByTestId("recording-row")).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId("recording-row")).toHaveAttribute("data-status", "complete", { timeout: 10_000 });
});

test("a reload mid-recording leaves a downloadable interrupted file", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await studio(page);
  await micOn(page);
  await startRecording(page);
  await page.waitForTimeout(6000); // past one progress save
  await page.reload();
  await page.goto("/");
  await expect(page.getByTestId("recording-row")).toHaveAttribute("data-status", "interrupted", { timeout: 10_000 });
  await expect(page.getByTestId("recording-row")).toContainText("Interrupted");
  const [row] = await rows(page);
  expect(row!.bytes).toBeGreaterThan(0);

  const dl = page.waitForEvent("download");
  await page.getByTestId("recording-row-download").click();
  const file = await loadRecording(page, await dl);
  const info = await fileInfo(page);
  expect(info.width).toBe(1920);
  // Real footage survived, not just a header: most of the 6s, about a keyframe interval short at worst.
  expect(countVideoFrames(file)).toBeGreaterThan(3 * 20);
  expect(near(await pixelAt(page, 1, ...BAR), [0, 0, 0], 40)).toBe(false);
});

test("deleting a recording removes its file; Erase removes them all", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  await studio(page);
  await micOn(page);
  for (let i = 0; i < 2; i++) {
    await startRecording(page);
    await page.waitForTimeout(1200);
    await page.getByTestId("record-toggle").click();
    await expect(page.getByTestId("recording-finished")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("recording-finished")).toHaveCount(0);
  }
  expect(await opfsFiles(page)).toHaveLength(2);

  await page.getByTestId("back-to-dashboard").click();
  await page.getByTestId("recording-row-delete").first().click();
  await expect(page.getByTestId("recording-row")).toHaveCount(1);
  expect(await opfsFiles(page)).toHaveLength(1);

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Erase" }).click();
  await expect(page.getByTestId("new-presentation")).toBeVisible();
  expect(await opfsFiles(page)).toEqual([]);
});

test("recording changes nothing the audience receives", async ({ page }) => {
  await studio(page);
  await micOn(page);
  const popup = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popup;
  await audience.waitForLoadState();
  const seq = () => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq());
  await expect.poll(seq).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const before = await seq();
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("recording-finished")).toBeVisible();
  expect(await seq()).toBe(before);
});

test("running out of storage stops the recording, says so, and keeps the file", async ({ page, context }) => {
  await context.addInitScript(() => {
    const est = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => ((window as unknown as { __full?: boolean }).__full ? { quota: 1000, usage: 999 } : est());
  });
  await studio(page);
  await micOn(page);
  await startRecording(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => void ((window as unknown as { __full: boolean }).__full = true));
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "idle", { timeout: 10_000 });
  await expect(page.getByTestId("record-message")).toContainText("nearly full");
  const [row] = await rows(page);
  expect(row!.status).toBe("interrupted");
  expect(row!.bytes).toBeGreaterThan(0);

  // And with no room to begin, it doesn't start.
  await page.keyboard.press("Escape");
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("record-message")).toContainText("enough storage");
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "idle");
});

test("a machine too slow to keep up loses frames, not the controls", async ({ page, context }) => {
  // Every draw takes longer than a frame's 33ms, as on an overloaded laptop.
  await context.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: unknown[]) {
      if ((window as unknown as { __slow?: boolean }).__slow) {
        const until = performance.now() + 60;
        while (performance.now() < until);
      }
      return (draw as (...a: unknown[]) => void).apply(this, args);
    };
  });
  await studio(page);
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  await micOn(page);
  await startRecording(page);
  await page.evaluate(() => void ((window as unknown as { __slow: boolean }).__slow = true));
  await page.waitForTimeout(6000);

  const started = Date.now();
  await page.getByTestId("slide-next").click({ timeout: 10_000 });
  await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
  expect(Date.now() - started).toBeLessThan(5000);

  await page.evaluate(() => void ((window as unknown as { __slow: boolean }).__slow = false));
  await page.getByTestId("record-toggle").click({ timeout: 10_000 });
  await expect(page.getByTestId("recording-finished")).toBeVisible({ timeout: 15_000 });
});

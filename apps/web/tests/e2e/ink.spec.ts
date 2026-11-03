import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";
import { fileInfo, loadRecording, pixelAt } from "./recordingProbe";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));
const PREVIEW = '[data-testid="preview-canvas"]';
const AUDIENCE = "#audience-canvas";
const RED = [239, 68, 68];

/** Slide-relative position, in a clean part of the fixture's white area. */
const A = { x: 0.6, y: 0.45 };
const B = { x: 0.9, y: 0.45 };
const MID = { x: 0.75, y: 0.45 };

const pixel = (page: Page, selector: string, p: { x: number; y: number }) =>
  page.evaluate(
    ({ selector, p }) => {
      const c = document.querySelector<HTMLCanvasElement>(selector)!;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(p.x * c.width), Math.round(p.y * c.height), 1, 1).data.slice(0, 3));
    },
    { selector, p },
  );

const near = (a: number[], b: number[], tolerance = 24) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
const isRed = async (page: Page, selector: string, p: { x: number; y: number }) => near(await pixel(page, selector, p), RED);
const isWhite = async (page: Page, selector: string, p: { x: number; y: number }) => near(await pixel(page, selector, p), [247, 247, 247]);

async function studio(page: Page) {
  const id = await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  return id;
}

/** Screen position of a point on the slide. The fixture fills the 16:9 output. */
async function onScreen(page: Page, p: { x: number; y: number }) {
  const box = (await page.locator(PREVIEW).boundingBox())!;
  return { x: box.x + p.x * box.width, y: box.y + p.y * box.height };
}

async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await onScreen(page, from);
  const b = await onScreen(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

const tool = (page: Page, name: string) => page.getByTestId(`ink-tool-${name}`);

async function openAudience(page: Page) {
  const popup = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popup;
  await audience.waitForLoadState();
  await expect.poll(() => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq())).toBeGreaterThan(0);
  return audience;
}

test.describe("marks", () => {
  test("the pen draws on the preview and shows in the audience window @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await studio(page);
    const audience = await openAudience(page);
    await page.bringToFront();
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);
    await expect.poll(() => isRed(audience, AUDIENCE, MID)).toBe(true);
  });

  test("the marks survive an audience reload @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await studio(page);
    const audience = await openAudience(page);
    await page.bringToFront();
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(audience, AUDIENCE, MID)).toBe(true);
    await audience.reload();
    await expect.poll(() => isRed(audience, AUDIENCE, MID), { timeout: 8000 }).toBe(true);
  });

  test("each slide keeps its own marks @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);
    await page.getByTestId("slide-next").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(false);
    await page.getByTestId("slide-prev").click();
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);
  });

  test("marks stay after a reload, until cleared @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);
    await page.waitForTimeout(200);
    await page.reload();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 15_000 });
    await expect.poll(() => isRed(page, PREVIEW, MID), { timeout: 5000 }).toBe(true);

    await page.getByTestId("ink-clear").click();
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(false);
    await page.waitForTimeout(200);
    await page.reload();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(await isRed(page, PREVIEW, MID)).toBe(false);
  });

  test("the eraser removes just the part it touches @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);

    await tool(page, "eraser").click();
    const across = { top: { x: MID.x, y: MID.y - 0.05 }, bottom: { x: MID.x, y: MID.y + 0.05 } };
    await draw(page, across.top, across.bottom);
    await expect.poll(() => isWhite(page, PREVIEW, MID)).toBe(true);
    expect(await isRed(page, PREVIEW, { x: 0.65, y: 0.45 })).toBe(true);
    expect(await isRed(page, PREVIEW, { x: 0.85, y: 0.45 })).toBe(true);
  });

  test("the highlighter lets the slide show through, in the colour chosen @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "highlighter").click();
    await page.getByTestId("ink-color-f59e0b").click();
    await draw(page, A, B);
    await expect.poll(async () => {
      const [r, g, b] = await pixel(page, PREVIEW, MID);
      return r! > 200 && g! > 180 && b! < 200 && b! > 100; // amber over white, not solid amber (b=11)
    }).toBe(true);
  });

  test("with no tool, the preview behaves as before @nomedia", async ({ page }) => {
    await studio(page);
    await expect(page.getByTestId("ink-layer")).toHaveCount(0);
    await draw(page, A, B);
    expect(await isRed(page, PREVIEW, MID)).toBe(false);
  });

  test("tool keys work, but not while typing @nomedia", async ({ page }) => {
    await studio(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("p");
    await expect(tool(page, "pen")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("h");
    await expect(tool(page, "highlighter")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await expect(tool(page, "eraser")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("l");
    await expect(tool(page, "pointer")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(tool(page, "pointer")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("script-paste").click();
    await page.keyboard.type("pehl");
    await expect(page.getByTestId("script-paste")).toHaveValue("pehl");
    for (const t of ["pen", "highlighter", "eraser", "pointer"]) await expect(tool(page, t)).toHaveAttribute("aria-pressed", "false");
  });

  test("tools are off with no slide on screen @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await expect(tool(page, "pen")).toBeDisabled();
    await page.getByTestId("studio-import-input").setInputFiles(deck);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await expect(tool(page, "pen")).toBeEnabled();
    await tool(page, "pen").click();
    await page.getByTestId("tab-camera").click();
    await page.getByTestId("layout-camera-full").click();
    await expect(tool(page, "pen")).toBeDisabled();
    await expect(page.getByTestId("ink-layer")).toHaveCount(0);
  });

  test("replacing the slides clears the marks @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);
    await page.getByTestId("studio-import-input").setInputFiles(deck);
    await expect(page.getByTestId("import-done")).toContainText("Replaced", { timeout: 30_000 });
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(false);
  });

  test("a full slide stops taking marks, says so, and nothing breaks @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "pen").click();
    await page.getByTestId("ink-layer").waitFor();
    // Fill it through real input would take minutes: 200 quick dabs reach the stroke limit.
    const spot = await onScreen(page, A);
    for (let i = 0; i < 201; i++) {
      await page.mouse.move(spot.x + (i % 20) * 2, spot.y + Math.floor(i / 20) * 2);
      await page.mouse.down();
      await page.mouse.up();
    }
    await expect(page.getByTestId("ink-full")).toBeVisible();
    await page.getByTestId("slide-next").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
  });
});

test.describe("pointer", () => {
  test("follows the mouse in the audience window and leaves no trace @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await studio(page);
    const audience = await openAudience(page);
    await page.bringToFront();
    await tool(page, "pointer").click();
    const at = await onScreen(page, MID);
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => isRed(audience, AUDIENCE, MID)).toBe(true);

    const other = { x: 0.65, y: 0.6 };
    const there = await onScreen(page, other);
    await page.mouse.move(there.x, there.y);
    await expect.poll(() => isRed(audience, AUDIENCE, other)).toBe(true);
    expect(await isRed(audience, AUDIENCE, MID)).toBe(false);

    await page.keyboard.press("Escape");
    await expect.poll(() => isRed(audience, AUDIENCE, other)).toBe(false);
  });

  test("goes when the mouse leaves the slide @nomedia", async ({ page }) => {
    await studio(page);
    await tool(page, "pointer").click();
    const at = await onScreen(page, MID);
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(true);
    await page.mouse.move(5, 5);
    await expect.poll(() => isRed(page, PREVIEW, MID)).toBe(false);
  });

  test("Stop all takes it away, and Resume doesn't bring it back @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await studio(page);
    const audience = await openAudience(page);
    await page.bringToFront();
    await tool(page, "pointer").click();
    const at = await onScreen(page, MID);
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => isRed(audience, AUDIENCE, MID)).toBe(true);

    await page.keyboard.press("Control+Shift+Escape");
    await expect(page.getByTestId("stopped-banner")).toBeVisible();
    await expect(tool(page, "pointer")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("resume-audience").click();
    await expect.poll(() => isWhite(audience, AUDIENCE, { x: 0.65, y: 0.6 }), { timeout: 5000 }).toBe(true);
    expect(await isRed(audience, AUDIENCE, MID)).toBe(false);
  });
});

test.describe("privacy", () => {
  test("choosing a tool sends nothing to the audience @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await studio(page);
    const audience = await openAudience(page);
    await page.bringToFront();
    const seq = () => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq());
    await page.waitForTimeout(300);
    const before = await seq();
    await tool(page, "pen").click();
    await page.getByTestId("ink-color-22c55e").click();
    await tool(page, "highlighter").click();
    await page.waitForTimeout(300);
    expect(await seq()).toBe(before);
  });

  test("the tools themselves never reach the audience window's page @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await studio(page);
    const audience = await openAudience(page);
    await page.bringToFront();
    await tool(page, "pen").click();
    await draw(page, A, B);
    await expect.poll(() => isRed(audience, AUDIENCE, MID)).toBe(true);
    expect(await audience.evaluate(() => [document.body.innerText.trim(), document.querySelectorAll("canvas").length, document.querySelectorAll("button, input").length])).toEqual(["", 1, 0]);
  });
});

test("marks and the pointer are in the recording @nomedia", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  test.setTimeout(60_000);
  await studio(page);
  await page.getByTestId("record-toggle").click();
  await page.getByTestId("record-without-voice").click();
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
  await page.waitForTimeout(2500);
  await tool(page, "pen").click();
  await draw(page, A, B);
  await page.waitForTimeout(2500);
  await tool(page, "pen").click();
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("recording-finished")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("recording-download")).toBeEnabled();
  const dl = page.waitForEvent("download");
  await page.getByTestId("recording-download").click();
  await loadRecording(page, await dl);
  const { duration } = await fileInfo(page);
  expect(near(await pixelAt(page, 1, MID.x, MID.y), [247, 247, 247], 30)).toBe(true); // before
  expect(near(await pixelAt(page, duration - 0.5, MID.x, MID.y), RED, 50)).toBe(true); // after
});

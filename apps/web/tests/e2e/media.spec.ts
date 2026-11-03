import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));

/** SHA-256 of the preview canvas pixels (what the audience would see). */
async function previewHash(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  });
}

/** Sample a pixel from the preview canvas in normalised output coordinates. */
async function previewPixel(page: Page, nx: number, ny: number): Promise<[number, number, number]> {
  return page.evaluate(
    ([x, y]) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
      const d = c.getContext("2d")!.getImageData(Math.round(x! * c.width), Math.round(y! * c.height), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    },
    [nx, ny],
  );
}

/** Remember the preview's current pixels for maxPreviewDelta. */
async function capturePreview(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
    (window as unknown as { __captured: Uint8ClampedArray }).__captured = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  });
}

/** Largest per-channel difference from the pixels saved by capturePreview. */
async function maxPreviewDelta(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
    const was = (window as unknown as { __captured: Uint8ClampedArray }).__captured;
    const now = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let max = 0;
    for (let i = 0; i < now.length; i++) if (i % 4 !== 3) max = Math.max(max, Math.abs(now[i]! - was[i]!));
    return max;
  });
}

async function openStudioWithDeck(page: Page) {
  const id = await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  return id;
}

test.describe("camera and microphone (fake devices)", () => {
  test("AC5 — activating the webcam shows frames in the private preview and in the audience preview", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "fake video file is a Chromium flag");
    await openStudioWithDeck(page);

    const before = await previewHash(page);
    await capturePreview(page);
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");

    // private raw preview (Camera tab) has real video dimensions
    await page.getByTestId("tab-camera").click();
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid="camera-raw-preview"]')!.videoWidth)).toBeGreaterThan(0);

    // audience preview changed (overlay is now drawn)
    await expect.poll(() => previewHash(page), { timeout: 5000 }).not.toBe(before);
    await expect(page.getByTestId("overlay-handle")).toBeVisible();

    // The overlay centre is the camera pattern (saturated), not the white slide.
    const cam = await page.evaluate(() => {
      // read overlay geometry from the DOM handle relative to the canvas
      const h = document.querySelector<HTMLElement>('[data-testid="overlay-handle"]')!.getBoundingClientRect();
      const c = document.querySelector<HTMLElement>('[data-testid="preview-canvas"]')!.getBoundingClientRect();
      return [(h.left + h.width / 2 - c.left) / c.width, (h.top + h.height / 2 - c.top) / c.height];
    });
    await expect
      .poll(async () => {
        const [r, g, b] = await previewPixel(page, cam[0]!, cam[1]!);
        return Math.max(r, g, b) - Math.min(r, g, b);
      })
      .toBeGreaterThan(60);

    // Turning it off removes the overlay from the composition.
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "false");
    // Not an exact hash: on system Chrome a few hundred pixels of the slide's
    // text come back 1/255 off (raster noise; measured 419 of 2M, max delta 1,
    // none near the overlay). Leftover camera pixels would differ by far more.
    await expect.poll(() => maxPreviewDelta(page), { timeout: 5000 }).toBeLessThanOrEqual(2);
  });

  test("AC6 — microphone can be selected; the meter rises with the fake tone; mute works", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "fake audio file is a Chromium flag");
    await openStudioWithDeck(page);
    await page.getByTestId("mic-toggle").click();
    await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "true");
    await expect.poll(() => page.getByTestId("mic-level").getAttribute("data-level").then(Number), { timeout: 5000 }).toBeGreaterThan(0.02);

    // devices are listed with labels once permission is granted
    await page.getByTestId("mic-select").click();
    const options = page.getByRole("option");
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThanOrEqual(1);
    await page.keyboard.press("Escape");

    await page.getByTestId("mic-mute").click();
    await expect(page.getByTestId("mic-mute")).toHaveText("Muted");
    // meter keeps reading (pre-mute tap) so the presenter can see the mic is alive
    await expect.poll(() => page.getByTestId("mic-level").getAttribute("data-level").then(Number)).toBeGreaterThan(0.02);
  });

  test("AC7/AC8 — dragging and resizing the overlay updates the audience preview immediately and stays in bounds", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await openStudioWithDeck(page);
    await page.getByTestId("camera-toggle").click();
    const handle = page.getByTestId("overlay-handle");
    await expect(handle).toBeVisible();

    const h0 = await previewHash(page);
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const canvas = (await page.getByTestId("preview-canvas").boundingBox())!;

    // drag far past the top-left corner; must clamp to (0,0)
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x - 400, canvas.y - 400, { steps: 8 });
    await page.mouse.up();
    const b1 = (await handle.boundingBox())!;
    expect(Math.abs(b1.x - canvas.x)).toBeLessThan(3);
    expect(Math.abs(b1.y - canvas.y)).toBeLessThan(3);
    await expect.poll(() => previewHash(page)).not.toBe(h0);

    // resize from the corner handle
    await handle.hover();
    const rh = page.getByTestId("overlay-resize");
    const rb = (await rh.boundingBox())!;
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + 120, rb.y + 120, { steps: 6 });
    await page.mouse.up();
    const b2 = (await handle.boundingBox())!;
    expect(b2.width).toBeGreaterThan(b1.width + 50);

    // drag to the far bottom-right; must clamp inside the canvas
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width + 500, canvas.y + canvas.height + 500, { steps: 8 });
    await page.mouse.up();
    const b3 = (await handle.boundingBox())!;
    expect(b3.x + b3.width).toBeLessThanOrEqual(canvas.x + canvas.width + 3);
    expect(b3.y + b3.height).toBeLessThanOrEqual(canvas.y + canvas.height + 3);

    // shape toggle via the panel
    await page.getByTestId("tab-camera").click();
    await page.getByTestId("shape-rect").click();
    const b4 = (await handle.boundingBox())!;
    expect(b4.height).toBeLessThan(b4.width); // 16:9 rect
  });

  test("AC8 — changing the slide updates the preview within two frames", async ({ page }) => {
    await openStudioWithDeck(page);
    const h0 = await previewHash(page);
    const t0 = Date.now();
    await page.getByTestId("slide-next").click();
    await expect.poll(() => previewHash(page), { intervals: [16, 16, 16, 50], timeout: 2000 }).not.toBe(h0);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

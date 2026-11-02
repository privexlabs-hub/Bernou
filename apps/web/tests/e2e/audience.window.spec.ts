import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));

async function canvasHash(page: Page, selector: string): Promise<string> {
  return page.evaluate(async (sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel)!;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }, selector);
}

async function setup(page: Page) {
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
}

async function openAudience(page: Page) {
  const popupPromise = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popupPromise;
  await audience.waitForLoadState();
  await expect(page.getByTestId("audience-window-open")).toHaveAttribute("data-open", "true");
  // wait for the first payload to be applied
  await expect.poll(() => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq()), { timeout: 5000 }).toBeGreaterThan(0);
  return audience;
}

test.describe("audience-only window", () => {
  /** AC9 + AC14 — the window displays the correct composition and is selectable for sharing. */
  test("AC9/AC14 — audience window renders the same composition as the preview and has a stable title", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await setup(page);
    const audience = await openAudience(page);

    await expect(audience).toHaveTitle("Bernou — Audience");
    expect(await audience.locator("canvas").count()).toBe(1);

    // same pixels as the preview for the same payload (camera off → deterministic)
    const preview = await canvasHash(page, '[data-testid="preview-canvas"]');
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 5000 }).toBe(preview);

    // slide change propagates
    await page.getByTestId("slide-next").click();
    const preview2 = await canvasHash(page, '[data-testid="preview-canvas"]');
    expect(preview2).not.toBe(preview);
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 5000 }).toBe(preview2);

    // camera on → audience re-acquires the same (fake) camera and shows it
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("overlay-handle")).toBeVisible();
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 5000 }).not.toBe(preview2);
    // the popup re-acquires the camera itself; poll until real frames (saturated pattern) arrive
    const camPixel = () =>
      audience.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("#audience-canvas")!;
        // default overlay: x .78 y .66 size .18 of 1920x1080 → centre ≈ (.87, .82)
        const d = c.getContext("2d")!.getImageData(Math.round(0.87 * c.width), Math.round(0.82 * c.height), 1, 1).data;
        return Math.max(d[0]!, d[1]!, d[2]!) - Math.min(d[0]!, d[1]!, d[2]!);
      });
    await expect.poll(camPixel, { timeout: 8000 }).toBeGreaterThan(60);

    // closing from the studio closes the popup
    await page.getByTestId("audience-window-close").click();
    await expect.poll(() => audience.isClosed()).toBe(true);
    await expect(page.getByTestId("audience-window-open")).toHaveAttribute("data-open", "false");
  });

  /** P3 — DOM audit: no text, no inputs, no buttons, exactly one canvas. */
  test("P3 — audience DOM contains only a canvas", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await setup(page);
    const audience = await openAudience(page);
    const audit = await audience.evaluate(() => ({
      text: document.body.innerText.trim(),
      inputs: document.querySelectorAll("input, textarea, button, select, a, [contenteditable]").length,
      canvases: document.querySelectorAll("canvas").length,
      // every body child must be the canvas or a non-rendering script tag
      visibleChildren: Array.from(document.body.children).filter((el) => el.tagName !== "SCRIPT").map((el) => el.tagName),
      hasReact: !!document.querySelector("[data-reactroot], #root"),
    }));
    expect(audit).toEqual({ text: "", inputs: 0, canvases: 1, visibleChildren: ["CANVAS"], hasReact: false });
  });

  /** P4 + P5 + AC10–AC13 — private edits never change the audience pixels; public edits do. */
  test("P4/P5 — scripts, notes, teleprompter and mic changes do not alter the audience output", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await setup(page);
    const audience = await openAudience(page);
    const h0 = await canvasHash(audience, "#audience-canvas");

    // --- private changes ---
    await page.getByTestId("tab-script").click();
    await page.getByTestId("script-paste").fill("CANARY-SCRIPT-9f2c " + "private words ".repeat(400));
    await page.getByTestId("script-paste-commit").click();
    await page.getByTestId("script-section").first().getByTestId("section-body").fill("Edited CANARY-SCRIPT-9f2c " + "x ".repeat(2500));
    await page.getByTestId("tab-notes").click();
    await page.getByTestId("notes-body").fill("CANARY-NOTES-4a71 do not show this");
    await page.getByTestId("tab-prompter").click();
    await page.getByTestId("prompter-toggle").click();
    await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "playing");
    await page.getByTestId("prompter-settings-toggle").click();
    await page.getByTestId("mic-toggle").click();
    await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "true");
    await page.getByTestId("mic-mute").click();
    await page.getByTestId("studio-title").fill("CANARY-TITLE-secret lecture");
    await page.getByTestId("studio-title").press("Enter");
    await page.waitForTimeout(700); // give any (wrong) propagation time to happen

    const h1 = await canvasHash(audience, "#audience-canvas");
    expect(h1, "private workspace changes altered the audience output").toBe(h0);
    expect(await audience.locator("body").innerText()).not.toContain("CANARY");

    // --- positive controls: public changes DO alter the output ---
    await page.getByTestId("slide-next").click();
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 5000 }).not.toBe(h0);
    const h2 = await canvasHash(audience, "#audience-canvas");
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("overlay-handle")).toBeVisible();
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 5000 }).not.toBe(h2);
    await page.getByTestId("tab-camera").click();
    await page.getByTestId("snap-tl").click();
    const h3 = await canvasHash(audience, "#audience-canvas");
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 5000 }).not.toBe(h3);
  });

  /** AC12 — recording controls (none exist yet) and all presenter controls are absent; verified by DOM audit above. */

  /** Window survives a reload of the audience page (re-hello) and a late open (hello retry). */
  test("audience page re-syncs after its own reload", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await setup(page);
    const audience = await openAudience(page);
    await page.getByTestId("slide-next").click();
    await page.getByTestId("slide-next").click();
    const expected = await canvasHash(page, '[data-testid="preview-canvas"]');
    await audience.reload();
    await expect.poll(() => canvasHash(audience, "#audience-canvas"), { timeout: 8000 }).toBe(expected);
  });
});

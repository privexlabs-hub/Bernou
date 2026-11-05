import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";
import { fillNumberedScript, wordAtReadingLine } from "./prompterHelpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));

const scrollTop = (page: Page) => page.getByTestId("prompter-viewport").evaluate((el) => el.scrollTop);
const status = (page: Page) => page.getByTestId("teleprompter");

// A 1x1 PNG. Images, because PDF import doesn't work in Playwright's WebKit, and the panel is for that browser.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function withScript(page: Page, { slides = false, images = false } = {}) {
  await createSessionViaUi(page);
  if (images) {
    await page.getByTestId("studio-import-input").setInputFiles(Array.from({ length: 5 }, (_, i) => ({ name: `slide${i + 1}.png`, mimeType: "image/png", buffer: PNG })));
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 5", { timeout: 30_000 });
  }
  if (slides) {
    await page.getByTestId("studio-import-input").setInputFiles(deck);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  }
  await fillNumberedScript(page);
  await page.getByTestId("tab-prompter").click();
}

async function openFloat(page: Page) {
  const opened = page.context().waitForEvent("page");
  await page.getByTestId("prompter-float").click();
  const pip = await opened;
  await pip.setViewportSize({ width: 560, height: 260 }); // what the app asks for, measured in real Chrome
  await expect(pip.getByTestId("float-prompter")).toBeVisible();
  return pip;
}

async function goDeep(page: Page) {
  await page.getByTestId("prompter-viewport").evaluate((el) => (el.scrollTop = 9000));
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(8000);
  await page.waitForTimeout(100);
}

async function rate(page: Page, ms = 1500) {
  const a = await scrollTop(page);
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  return (await scrollTop(page) - a) / ((Date.now() - t0) / 1000);
}

test.describe("floating prompter window @nomedia", () => {
  test.skip(({ browserName }) => browserName === "webkit", "Safari has no floating window: it gets the panel, tested below");

  test("opens from the button, styled, with the text in one place only @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);

    await expect(pip.getByTestId("prompter-section")).toHaveCount(30);
    await expect(page.getByTestId("prompter-viewport")).toHaveCount(0);
    await expect(page.getByTestId("prompter-floating-notice")).toBeVisible();
    // The app's stylesheet reached the new window: the primary button is filled, not bare.
    const background = await pip.getByTestId("float-toggle").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    // Text on top, nearest the camera; controls under it.
    const text = (await pip.getByTestId("prompter-viewport").boundingBox())!;
    const button = (await pip.getByTestId("float-toggle").boundingBox())!;
    expect(button.y).toBeGreaterThanOrEqual(text.y + text.height);
    expect(text.height).toBeGreaterThan(150);
  });

  test("plays there, and carries on with the main window on another tab @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await pip.getByTestId("float-toggle").click();
    await expect(status(page)).toHaveAttribute("data-status", "playing");
    await expect.poll(() => scrollTop(pip)).toBeGreaterThan(10);

    await page.getByTestId("tab-script").click();
    const top = await scrollTop(pip);
    await expect.poll(() => scrollTop(pip)).toBeGreaterThan(top + 20);
  });

  test("the clock is right: at speed 40 it moves about 40 px a second @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await pip.getByTestId("float-toggle").click();
    await expect.poll(() => scrollTop(pip)).toBeGreaterThan(5);
    const measured = await rate(pip, 3000);
    expect(measured).toBeGreaterThan(30);
    expect(measured).toBeLessThan(50);
  });

  test("speed buttons and keys change the real scroll rate @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await expect(pip.getByTestId("float-speed")).toHaveText("40");
    await pip.getByTestId("float-slower").click();
    await expect(pip.getByTestId("float-speed")).toHaveText("35");
    await pip.getByTestId("float-faster").click();
    await expect(pip.getByTestId("float-speed")).toHaveText("40");

    await pip.keyboard.press("ArrowLeft");
    await expect(pip.getByTestId("float-speed")).toHaveText("35");
    for (let i = 0; i < 4; i++) await pip.keyboard.press("ArrowLeft");
    await expect(pip.getByTestId("float-speed")).toHaveText("15");
    // The main window's transport drives the same speed.
    await expect(page.getByTestId("prompter-speed")).toHaveText("15");

    await pip.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "playing");
    await expect.poll(() => scrollTop(pip)).toBeGreaterThan(2);
    const slow = await rate(pip);
    for (let i = 0; i < 17; i++) await pip.keyboard.press("ArrowRight");
    await expect(pip.getByTestId("float-speed")).toHaveText("100");
    const fast = await rate(pip);
    expect(fast).toBeGreaterThan(slow * 3);
  });

  test("other prompter keys work there, once each @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await pip.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "playing");
    await pip.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "paused");

    const top = await scrollTop(pip);
    await pip.keyboard.press("ArrowDown");
    await expect.poll(() => scrollTop(pip)).toBeGreaterThanOrEqual(top + 39);
    expect(await scrollTop(pip)).toBeLessThan(top + 41); // once, not twice

    await pip.keyboard.press("Escape");
    await expect(status(page)).toHaveAttribute("data-status", "idle");
    await pip.keyboard.press("Home");
    await expect.poll(() => scrollTop(pip)).toBe(0);
  });

  test("slide buttons and Page keys change the slide everywhere, ends stop them @nomedia", async ({ page }) => {
    await withScript(page, { slides: true });
    const pip = await openFloat(page);
    await expect(pip.getByTestId("float-slide-counter")).toHaveText("1 / 20");
    await expect(pip.getByTestId("float-slide-prev")).toBeDisabled();

    await pip.getByTestId("float-slide-next").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
    await expect(pip.getByTestId("float-slide-counter")).toHaveText("2 / 20");
    await pip.keyboard.press("PageDown");
    await expect(page.getByTestId("slide-counter")).toHaveText("3 / 20");
    await pip.keyboard.press("PageUp");
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
    await pip.getByTestId("float-slide-prev").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20");

    // A slide change from the main window shows here too, and the far end stops Next.
    for (let i = 0; i < 19; i++) await page.getByTestId("slide-next").click();
    await expect(pip.getByTestId("float-slide-counter")).toHaveText("20 / 20");
    await expect(pip.getByTestId("float-slide-next")).toBeDisabled();
  });

  test("PageDown changes the slide without scrolling the text @nomedia", async ({ page }) => {
    await withScript(page, { slides: true });
    const pip = await openFloat(page);
    await pip.getByTestId("prompter-viewport").click();
    const top = await scrollTop(pip);
    await pip.keyboard.press("PageDown");
    await expect(pip.getByTestId("float-slide-counter")).toHaveText("2 / 20");
    await pip.waitForTimeout(200);
    expect(await scrollTop(pip)).toBe(top);
  });

  test("with no slides, the slide buttons are off @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await expect(pip.getByTestId("float-slide-counter")).toHaveText("No slides");
    await expect(pip.getByTestId("float-slide-next")).toBeDisabled();
    await expect(pip.getByTestId("float-slide-prev")).toBeDisabled();
    await pip.keyboard.press("PageDown"); // nothing to go to, and nothing breaks
    await expect(pip.getByTestId("float-prompter")).toBeVisible();
  });

  test("Space after clicking a slide button is play, not that button again @nomedia", async ({ page }) => {
    await withScript(page, { slides: true });
    const pip = await openFloat(page);
    await pip.getByTestId("float-slide-next").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
    await pip.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "playing");
    await pip.waitForTimeout(200);
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
    await pip.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "paused");
  });

  test("Follow slides works from there @nomedia", async ({ page }) => {
    await withScript(page, { slides: true });
    await page.getByTestId("tab-script").click();
    await page.getByTestId("section-slide").nth(8).click();
    await page.getByRole("option", { name: "Slide 2", exact: true }).click();
    await page.getByTestId("tab-prompter").click();
    await page.getByTestId("prompter-settings-toggle").click();
    await page.getByTestId("prompter-follow").click();

    const pip = await openFloat(page);
    expect(await scrollTop(pip)).toBe(0); // opening isn't a slide change
    await pip.getByTestId("float-slide-next").click();
    await expect.poll(() => scrollTop(pip), { timeout: 3000 }).toBeGreaterThan(500);
    await expect(pip.getByTestId("prompter-section").nth(8)).toHaveAttribute("data-current", "true");
  });

  test("settings in the main window apply to the floating text live @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    const size = () => pip.getByTestId("prompter-section").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const before = await size();
    await page.getByTestId("prompter-settings-toggle").click();
    await page.getByTestId("prompter-font-size").getByRole("slider").focus();
    await page.keyboard.press("ArrowLeft");
    await expect.poll(size).toBe(before - 1);
  });

  for (const how of ["the Bring back button", "the float's own button", "the window closing"] as const) {
    for (const playing of [false, true]) {
      test(`${how} returns to the same place, ${playing ? "playing" : "paused"} @nomedia`, async ({ page }) => {
        await withScript(page);
        await goDeep(page);
        const start = await wordAtReadingLine(page);
        const pip = await openFloat(page);
        await pip.waitForTimeout(200);
        expect(Math.abs((await wordAtReadingLine(pip)) - start)).toBeLessThan(40); // the move out

        if (playing) {
          await pip.getByTestId("float-toggle").click();
          await expect(status(page)).toHaveAttribute("data-status", "playing");
          await pip.waitForTimeout(500);
        }
        const before = await wordAtReadingLine(pip);
        const closed = pip.waitForEvent("close");
        if (how === "the Bring back button") await page.getByTestId("prompter-bring-back").click();
        else if (how === "the float's own button") await pip.getByTestId("float-back").click().catch(() => undefined); // it closes mid-click
        else await pip.evaluate(() => window.close());
        await closed;

        await expect(page.getByTestId("prompter-viewport")).toBeVisible();
        await page.waitForTimeout(150);
        const after = await wordAtReadingLine(page);
        expect(after).toBeGreaterThanOrEqual(before - 40);
        expect(after).toBeLessThan(before + 80);

        await expect(status(page)).toHaveAttribute("data-status", playing ? "playing" : "idle");
        if (playing) {
          const top = await scrollTop(page);
          await expect.poll(() => scrollTop(page)).toBeGreaterThan(top + 10);
        }
      });
    }
  }

  test("still at the same place after several frames, from deep in the script @nomedia", async ({ page }) => {
    await withScript(page);
    await goDeep(page);
    const start = await wordAtReadingLine(page);
    const pip = await openFloat(page);
    for (let i = 0; i < 5; i++) {
      await pip.waitForTimeout(200);
      expect(Math.abs((await wordAtReadingLine(pip)) - start)).toBeLessThan(40);
    }
  });

  test("resizing the window while playing keeps the place @nomedia", async ({ page }) => {
    await withScript(page);
    await goDeep(page);
    const pip = await openFloat(page);
    const before = await wordAtReadingLine(pip);
    await pip.getByTestId("float-toggle").click();
    for (const width of [480, 360, 300, 700]) {
      await pip.setViewportSize({ width, height: 260 });
      await pip.waitForTimeout(150);
    }
    await pip.setViewportSize({ width: 360, height: 200 });
    await pip.waitForTimeout(150);
    const after = await wordAtReadingLine(pip);
    expect(after).toBeGreaterThanOrEqual(before - 40);
    expect(after).toBeLessThan(before + 80);
    const top = await scrollTop(pip);
    await expect.poll(() => scrollTop(pip)).toBeGreaterThan(top + 10);
  });

  test("the smallest window Chrome allows still shows every control @nomedia", async ({ page }) => {
    await withScript(page, { slides: true });
    const pip = await openFloat(page);
    await pip.setViewportSize({ width: 240, height: 260 });
    for (const id of ["float-toggle", "float-slower", "float-faster", "float-slide-prev", "float-slide-next", "float-back"]) {
      const box = (await pip.getByTestId(id).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(240);
      expect(box.y + box.height).toBeLessThanOrEqual(260);
    }
    expect(await pip.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(240);
  });

  test("reopens after closing, and the Float button brings it back too @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    const closed = pip.waitForEvent("close");
    await page.getByTestId("prompter-float").click();
    await closed;
    await expect(page.getByTestId("prompter-viewport")).toBeVisible();

    const again = await openFloat(page);
    await expect(again.getByTestId("prompter-section")).toHaveCount(30);
  });

  test("a refused window says so, and the text stays in the tab @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "patching the prototype is enough to check this once");
    await page.addInitScript(() => {
      const pip = (window as unknown as { documentPictureInPicture: { requestWindow: () => Promise<Window> } }).documentPictureInPicture;
      pip.requestWindow = () => Promise.reject(new DOMException("no", "NotAllowedError"));
    });
    await withScript(page);
    await page.getByTestId("prompter-float").click();
    await expect(page.getByTestId("prompter-float-error")).toBeVisible();
    await expect(page.getByTestId("prompter-viewport")).toBeVisible();
    await expect(page.getByTestId("prompter-toggle")).toBeEnabled();
  });

  test("leaving the presentation closes it, and the next one starts at the top @nomedia", async ({ page }) => {
    await withScript(page);
    await goDeep(page);
    const pip = await openFloat(page);
    const closed = pip.waitForEvent("close");
    await page.getByTestId("back-to-dashboard").click();
    await closed;

    await page.getByTestId("new-presentation").click();
    await fillNumberedScript(page);
    await page.getByTestId("tab-prompter").click();
    await page.waitForTimeout(200);
    expect(await scrollTop(page)).toBe(0);
    await expect(page.getByTestId("prompter-viewport")).toBeVisible();
  });

  test("reloading closes it and the tab has the text again @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    const closed = pip.waitForEvent("close");
    await page.reload();
    await closed;
    await page.getByTestId("tab-prompter").click();
    await expect(page.getByTestId("prompter-viewport")).toBeVisible();
  });

  test("with no script, Float is off @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await page.getByTestId("tab-prompter").click();
    await expect(page.getByTestId("prompter-float")).toBeDisabled();
  });

  test("deleting the whole script while floating stops it, and Space can't restart it @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await page.getByTestId("script-paste").fill("Only one short section of text.");
    await page.getByTestId("script-paste-commit").click();
    await page.getByTestId("tab-prompter").click();
    const pip = await openFloat(page);
    await pip.getByTestId("float-toggle").click();
    await expect(status(page)).toHaveAttribute("data-status", /playing|paused/);
    await page.getByTestId("tab-script").click();
    await page.getByTestId("section-delete").first().click();
    await expect(status(page)).toHaveAttribute("data-status", "idle");
    await expect(pip.getByTestId("float-toggle")).toBeDisabled();
    await pip.keyboard.press("Space");
    await pip.waitForTimeout(200);
    await expect(status(page)).toHaveAttribute("data-status", "idle");
  });
});

test.describe("floating prompter and the audience", () => {
  async function openAudience(page: Page) {
    const opened = page.context().waitForEvent("page");
    await page.getByTestId("audience-window-open").click();
    const audience = await opened;
    await audience.waitForLoadState();
    await expect.poll(() => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq())).toBeGreaterThan(0);
    return audience;
  }
  const canvasPixels = (page: Page, selector: string) =>
    page.evaluate(async (sel) => {
      const c = document.querySelector<HTMLCanvasElement>(sel)!;
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    }, selector);

  test("a slide change from the float reaches the audience window", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await withScript(page, { slides: true });
    const audience = await openAudience(page);
    await audience.waitForTimeout(800);
    const first = await canvasPixels(audience, "#audience-canvas");

    const pip = await openFloat(page);
    await pip.getByTestId("float-slide-next").click();
    await expect.poll(() => canvasPixels(audience, "#audience-canvas"), { timeout: 8000 }).not.toBe(first);
  });

  test("opening and driving the float publishes nothing, and no script crosses", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await page.addInitScript(() => {
      const frames: string[] = [];
      (window as unknown as { __frames: string[] }).__frames = frames;
      const orig = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (msg: unknown) {
        frames.push(JSON.stringify(msg, (_k, v) => (v instanceof Blob ? `<blob:${v.size}>` : v)));
        return orig.call(this, msg);
      };
    });
    await withScript(page, { slides: true });
    const audience = await openAudience(page);
    await audience.waitForTimeout(2000); // past the audience's hello retries

    const payloads = () => page.evaluate(() => (window as unknown as { __frames: string[] }).__frames.filter((f) => f.includes('"seq"')).length);
    const before = await payloads();
    const pip = await openFloat(page);
    await pip.getByTestId("float-toggle").click();
    await pip.getByTestId("float-faster").click();
    await pip.getByTestId("float-slower").click();
    await pip.keyboard.press("ArrowDown");
    await pip.waitForTimeout(800);
    await pip.keyboard.press("Space");
    await pip.setViewportSize({ width: 400, height: 240 });
    await pip.waitForTimeout(300);
    expect(await payloads()).toBe(before);

    // A slide change is a payload, the positive control, and still carries no script.
    await pip.getByTestId("float-slide-next").click();
    await expect.poll(payloads).toBeGreaterThan(before);
    const frames = await page.evaluate(() => (window as unknown as { __frames: string[] }).__frames);
    for (const f of frames) expect(f).not.toMatch(/\bw\d{1,4}\b/);
  });

  test("the float can't be seen in the audience canvas", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await withScript(page, { slides: true });
    const audience = await openAudience(page);
    await audience.waitForTimeout(1000);
    const before = await canvasPixels(audience, "#audience-canvas");
    const pip = await openFloat(page);
    await pip.getByTestId("float-toggle").click();
    await pip.waitForTimeout(1000);
    expect(await canvasPixels(audience, "#audience-canvas")).toBe(before);
  });
});

test.describe("Stop all and the float", () => {
  test("the shortcut pressed in the float stops everything and closes it", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await withScript(page);
    await page.getByTestId("mic-toggle").click();
    await expect(page.getByTestId("indicator-mic")).toHaveAttribute("data-on", "true");
    const pip = await openFloat(page);
    await pip.getByTestId("float-toggle").click();
    await expect(status(page)).toHaveAttribute("data-status", "playing");

    const closed = pip.waitForEvent("close");
    // The window closes on key-down, so the press can't finish: what follows is the check.
    await pip.keyboard.press("Control+Shift+Escape").catch(() => undefined);
    await closed;
    await expect(page.getByTestId("stopped-banner")).toBeVisible();
    await expect(page.getByTestId("indicator-mic")).toHaveAttribute("data-on", "false");
    await expect(status(page)).toHaveAttribute("data-status", "idle");

    // Resume is about the audience: the float needs a click of its own.
    await page.getByTestId("resume-audience").click();
    await page.waitForTimeout(300);
    expect(page.context().pages().filter((p) => p !== page).length).toBe(0);
    await expect(page.getByTestId("prompter-viewport")).toBeVisible();
  });

  test("the Stop all button in the main window closes it too", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await withScript(page);
    const pip = await openFloat(page);
    const closed = pip.waitForEvent("close");
    await page.getByTestId("emergency-stop").click();
    await closed;
    await expect(page.getByTestId("stopped-banner")).toBeVisible();
  });

  test("the shortcut still works with the prompter's own text focused @nomedia", async ({ page }) => {
    await withScript(page);
    await page.getByTestId("prompter-viewport").focus();
    await page.keyboard.press("Control+Shift+Escape");
    await expect(page.getByTestId("stopped-banner")).toBeVisible();
  });
});

test.describe("floating panel, in a browser without the window @nomedia", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }));
  });

  async function openPanel(page: Page) {
    await page.getByTestId("prompter-float").click();
    const panel = page.getByTestId("float-prompter");
    await expect(panel).toHaveAttribute("data-kind", "panel");
    return panel;
  }

  test("opens in the page, at the top and centred, holding the text @nomedia", async ({ page }) => {
    await withScript(page);
    const panel = await openPanel(page);
    await expect(panel.getByTestId("prompter-section")).toHaveCount(30);
    await expect(page.getByTestId("prompter-viewport")).toHaveCount(1);
    await expect(page.getByTestId("prompter-floating-notice")).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeLessThan(20);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(2);
    expect(page.context().pages()).toHaveLength(1);
  });

  /** Drags the handle to a point. At a corner, an unclamped panel would hang off the window. */
  async function dragTo(page: Page, toX: number, toY: number) {
    const handle = (await page.getByTestId("float-drag-handle").boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move((x + toX) / 2, (y + toY) / 2);
    await page.mouse.move(toX, toY);
    await page.mouse.up();
  }
  async function dragBy(page: Page, dx: number, dy: number) {
    const handle = (await page.getByTestId("float-drag-handle").boundingBox())!;
    await dragTo(page, handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy);
  }

  test("drags with the mouse and can't leave the window @nomedia", async ({ page }) => {
    await withScript(page);
    const panel = await openPanel(page);
    const a = (await panel.boundingBox())!;
    await dragBy(page, -200, 100);
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeCloseTo(a.x - 200, 0);
    expect((await panel.boundingBox())!.y).toBeCloseTo(a.y + 100, 0);

    await dragTo(page, 0, 0);
    await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0);
    expect((await panel.boundingBox())!.y).toBe(0);
    await dragTo(page, 1279, 719);
    const b = (await panel.boundingBox())!;
    expect(b.x + b.width).toBeCloseTo(1280, 0);
    expect(b.y + b.height).toBeCloseTo(720, 0);
  });

  test("a smaller browser window keeps it reachable @nomedia", async ({ page }) => {
    await withScript(page);
    const panel = await openPanel(page);
    await dragTo(page, 1279, 719);
    await page.setViewportSize({ width: 800, height: 500 });
    await expect.poll(async () => { const b = (await panel.boundingBox())!; return b.x + b.width; }).toBeLessThanOrEqual(800);
    const b = (await panel.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(500);
    expect(b.x).toBeGreaterThanOrEqual(0);
  });

  test("its place is remembered after a reload @nomedia", async ({ page }) => {
    await withScript(page);
    const panel = await openPanel(page);
    await dragBy(page, -150, 80);
    const a = (await panel.boundingBox())!;
    await page.reload();
    await page.getByTestId("tab-prompter").click();
    await expect(page.getByTestId("prompter-viewport")).toBeVisible();
    const again = await openPanel(page);
    const b = (await again.boundingBox())!;
    expect(b.x).toBeCloseTo(a.x, 0);
    expect(b.y).toBeCloseTo(a.y, 0);
  });

  test("blocked storage doesn't break it @nomedia", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Storage.prototype.setItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
    });
    await withScript(page);
    const panel = await openPanel(page);
    await dragBy(page, -50, 50);
    await expect(panel).toBeVisible();
  });

  test("resizing by its corner keeps the place and is remembered @nomedia", async ({ page }) => {
    await withScript(page);
    await goDeep(page);
    const start = await wordAtReadingLine(page);
    const panel = await openPanel(page);
    await page.waitForTimeout(200);
    expect(Math.abs((await wordAtReadingLine(page)) - start)).toBeLessThan(40);

    const box = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 120, box.y + box.height + 60);
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(box.width - 60);
    await page.waitForTimeout(200);
    expect(Math.abs((await wordAtReadingLine(page)) - start)).toBeLessThan(40);
  });

  test("controls work; arrow keys with focus in it change speed, not the slide @nomedia", async ({ page }) => {
    await withScript(page, { images: true });
    const panel = await openPanel(page);
    await panel.getByTestId("float-faster").click();
    await expect(panel.getByTestId("float-speed")).toHaveText("45");
    await panel.getByTestId("float-slide-next").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 5");

    await page.keyboard.press("ArrowRight"); // focus stayed in the panel
    await expect(panel.getByTestId("float-speed")).toHaveText("50");
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 5");
    await page.keyboard.press("PageDown");
    await expect(page.getByTestId("slide-counter")).toHaveText("3 / 5");

    await page.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "playing");
    await page.keyboard.press("Space");
    await expect(status(page)).toHaveAttribute("data-status", "paused");
  });

  test("the same keys with focus in the main window still change the slide @nomedia", async ({ page }) => {
    await withScript(page, { images: true });
    const panel = await openPanel(page);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("slide-counter")).toHaveText("2 / 5");
    await expect(panel.getByTestId("float-speed")).toHaveText("40");
  });

  test("Bring back returns the text to the same place @nomedia", async ({ page }) => {
    await withScript(page);
    await goDeep(page);
    await openPanel(page);
    await page.waitForTimeout(200);
    const before = await wordAtReadingLine(page);
    await page.getByTestId("float-back").click();
    await expect(page.getByTestId("float-prompter")).toHaveCount(0);
    await page.waitForTimeout(150);
    expect(Math.abs((await wordAtReadingLine(page)) - before)).toBeLessThan(40);
  });

  test("Stop all closes it @nomedia", async ({ page }) => {
    await withScript(page);
    await openPanel(page);
    await page.getByTestId("emergency-stop").click();
    await expect(page.getByTestId("float-prompter")).toHaveCount(0);
    await expect(page.getByTestId("stopped-banner")).toBeVisible();
  });
});

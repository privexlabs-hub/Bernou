import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));

/**
 * Regression: Emergency Stop must end a capture whose getUserMedia is still in
 * flight. Slowing getUserMedia makes the ordering deterministic; the assertions
 * read real MediaStreamTrack state rather than the UI.
 */
function slowGetUserMedia(ctx: BrowserContext, ms: number, onlyPath?: string) {
  return ctx.addInitScript(
    ([delay, path]) => {
      const w = window as unknown as { __tracks: MediaStreamTrack[]; __gumCalls: number };
      w.__tracks = [];
      w.__gumCalls = 0;
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        w.__gumCalls++;
        if (!path || location.pathname === path) await new Promise((r) => setTimeout(r, delay as number));
        const s = await orig(c);
        w.__tracks.push(...s.getTracks());
        return s;
      };
    },
    [ms, onlyPath ?? null] as const,
  );
}

const liveTracks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === "live").length);

for (const kind of ["mic", "camera"] as const) {
  test(`P9b — stop while the ${kind} is still starting leaves nothing live`, async ({ page, browserName, context }) => {
    test.skip(browserName !== "chromium");
    await slowGetUserMedia(context, 800);
    await createSessionViaUi(page);
    await page.getByTestId(`${kind}-toggle`).click();
    await page.waitForTimeout(100); // the request is in flight
    await page.keyboard.press("Control+Shift+Escape");
    await expect(page.getByTestId("stopped-banner")).toBeVisible();
    await expect(page.getByTestId("stopped-banner")).toContainText("1 pending start cancelled");

    await page.waitForTimeout(1500); // long after the request resolved
    expect(await liveTracks(page)).toBe(0);
    await expect(page.getByTestId(`indicator-${kind}`)).toHaveAttribute("data-on", "false");
    await expect(page.getByTestId(`${kind}-toggle`)).toBeEnabled();
    await expect(page.getByTestId(`${kind}-toggle`)).toHaveAttribute("data-live", "false");
  });
}

async function openAudience(page: Page) {
  const popup = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popup;
  await audience.waitForLoadState();
  await expect.poll(() => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq())).toBeGreaterThan(0);
  return audience;
}

test("P9c — blanking during the audience window's camera start leaves nothing live", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium");
  await slowGetUserMedia(context, 1000, "/audience.html");
  await createSessionViaUi(page);
  const audience = await openAudience(page);
  // Outlast the audience's hello retry: if it's still running, the reply to it
  // is a second `blank` that would hide the race this test is here to catch.
  await audience.waitForTimeout(1500);

  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  // Stop only once the audience window's own request is really in flight.
  await expect.poll(() => audience.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls)).toBe(1);
  await page.keyboard.press("Control+Shift+Escape");
  await expect(page.getByTestId("stopped-banner")).toBeVisible();

  await audience.waitForTimeout(1800); // the audience's request has resolved by now
  expect(await liveTracks(audience)).toBe(0);
});

test("AC9b — payloads during the audience camera start keep one stream, and it reaches the canvas", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium");
  await slowGetUserMedia(context, 800, "/audience.html");
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  const audience = await openAudience(page);

  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  // Each slide change is a payload that lands while the camera is starting.
  for (let i = 0; i < 4; i++) await page.getByTestId("slide-next").click();

  const camPixel = () =>
    audience.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>("#audience-canvas")!;
      const d = c.getContext("2d")!.getImageData(Math.round(0.87 * c.width), Math.round(0.82 * c.height), 1, 1).data;
      return Math.max(d[0]!, d[1]!, d[2]!) - Math.min(d[0]!, d[1]!, d[2]!);
    });
  await expect.poll(camPixel, { timeout: 8000 }).toBeGreaterThan(60);
  expect(await liveTracks(audience)).toBe(1);
});

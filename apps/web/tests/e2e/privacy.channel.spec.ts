import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));

const CANARIES = ["CANARY-SCRIPT-9f2c", "CANARY-NOTES-4a71", "CANARY-TITLE-c0de", "CANARY-SECTION-77d1"];

/**
 * Installs a spy on BroadcastChannel.postMessage BEFORE the app loads and
 * records a deep text serialisation of every outbound frame (Blobs are read
 * as text too, so a canary hidden in a Blob would be caught).
 */
async function installChannelSpy(page: Page) {
  await page.addInitScript(() => {
    const frames: { channel: string; body: string }[] = [];
    (window as unknown as { __bcFrames: typeof frames }).__bcFrames = frames;
    const orig = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (msg: unknown) {
      const channel = this.name;
      const walk = async (v: unknown): Promise<string> => {
        if (v instanceof Blob) return `<blob:${v.type}:${(await v.text()).slice(0, 200000)}>`;
        if (Array.isArray(v)) return `[${(await Promise.all(v.map(walk))).join(",")}]`;
        if (v && typeof v === "object") {
          const parts: string[] = [];
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) parts.push(`${k}:${await walk(val)}`);
          return `{${parts.join(",")}}`;
        }
        return String(v);
      };
      void walk(msg).then((body) => frames.push({ channel, body }));
      return orig.call(this, msg);
    };
  });
}

/** P2 — canary scan of every frame that crosses the audience channel. */
test("P2 — no private canary ever crosses the audience channel", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  await installChannelSpy(page);
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });

  // seed every private surface with a canary
  await page.getByTestId("studio-title").fill(CANARIES[2]!);
  await page.getByTestId("studio-title").press("Enter");
  await page.getByTestId("tab-script").click();
  await page.getByTestId("script-paste").fill(`${CANARIES[0]}\n\n${CANARIES[3]}`);
  await page.getByTestId("script-paste-commit").click();
  await page.getByTestId("section-split").first().click();
  await page.getByTestId("script-section").first().getByTestId("section-title").fill(CANARIES[3]);
  await page.getByTestId("tab-notes").click();
  await page.getByTestId("notes-body").fill(CANARIES[1]!);

  // open the audience window (hello → payload → asset-request → asset) and exercise everything
  const popupPromise = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popupPromise;
  await audience.waitForLoadState();
  await page.getByTestId("camera-toggle").click();
  await page.getByTestId("slide-next").click();
  await page.getByTestId("tab-prompter").click();
  await page.getByTestId("prompter-toggle").click();
  await page.getByTestId("tab-camera").click();
  await page.getByTestId("snap-tr").click();
  await page.getByTestId("emergency-stop").click();
  await page.getByTestId("resume-audience").click();
  await page.waitForTimeout(800);

  const all = await page.evaluate(() => (window as unknown as { __bcFrames: { channel: string; body: string }[] }).__bcFrames);
  // Canaries must not appear on ANY channel (Dexie also uses BroadcastChannel for cache invalidation).
  for (const f of all) for (const c of CANARIES) expect(f.body, `frame on ${f.channel} contained ${c}`).not.toContain(c);

  // Bernou's own audience channel: nothing but the allowed envelopes, no names/labels/private words.
  const ours = all.filter((f) => f.channel === "bernou-audience-v1").map((f) => f.body);
  expect(ours.length).toBeGreaterThan(3);
  expect(ours.some((b) => b.startsWith("{type:payload"))).toBe(true);
  expect(ours.some((b) => b.startsWith("{type:asset,"))).toBe(true);
  for (const b of ours) {
    expect(b).toMatch(/^\{type:(payload|asset|blank|bye|hello|asset-request|audience-status)[,}]/);
    expect(b).not.toContain("lecture-20");
    expect(b).not.toMatch(/label|Fake Default|notes|script|teleprompter|recording|title:[^n]/i);
  }
});

/** P9 — Emergency Stop ends every track and blanks the audience; indicators reflect real state. */
test("P9 — emergency stop ends all capture tracks and blanks the audience window", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium");
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });

  await page.getByTestId("camera-toggle").click();
  await page.getByTestId("mic-toggle").click();
  const popupPromise = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popupPromise;
  await audience.waitForLoadState();

  await expect(page.getByTestId("indicator-camera")).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("indicator-mic")).toHaveAttribute("data-on", "true");
  await expect(page.getByTestId("indicator-audience")).toHaveAttribute("data-on", "true");

  // Capture every track created in the presenter page so we can check readyState afterwards.
  await page.evaluate(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await orig(c);
      w.__tracks.push(...s.getTracks());
      return s;
    };
  });
  // re-start devices so the spy sees their tracks
  await page.getByTestId("camera-toggle").click();
  await page.getByTestId("camera-toggle").click();
  await page.getByTestId("mic-toggle").click();
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("indicator-camera")).toHaveAttribute("data-on", "true");

  const audienceBefore = await audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq());
  expect(audienceBefore).toBeGreaterThan(0);

  await page.keyboard.press("Control+Shift+Escape");
  await expect(page.getByTestId("stopped-banner")).toBeVisible();
  await expect(page.getByTestId("indicator-camera")).toHaveAttribute("data-on", "false");
  await expect(page.getByTestId("indicator-mic")).toHaveAttribute("data-on", "false");
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "false");
  await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "false");

  const states = await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState));
  expect(states.length).toBeGreaterThanOrEqual(2);
  expect(states.every((s) => s === "ended")).toBe(true);

  // audience shows the neutral frame: sample centre pixel
  await expect
    .poll(() =>
      audience.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("#audience-canvas")!;
        const d = c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1).data;
        return [d[0], d[1], d[2]];
      }),
    )
    .toEqual([0x0b, 0x0d, 0x12]);

  // the window stays open (no alarming disappearance) and can be resumed
  expect(audience.isClosed()).toBe(false);
  await page.getByTestId("resume-audience").click();
  await expect
    .poll(() =>
      audience.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("#audience-canvas")!;
        const d = c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1).data;
        return d[0]! > 200; // slide is light
      }),
    )
    .toBe(true);
});

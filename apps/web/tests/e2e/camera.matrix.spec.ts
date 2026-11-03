import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi, readSessionFromIdb } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));
const PREVIEW = '[data-testid="preview-canvas"]';

test.skip(({ browserName }) => browserName !== "chromium", "fake camera file is a Chromium flag");

/** SHA-256 of a normalised region of a canvas. */
async function regionHash(page: Page, selector: string, [x, y, w, h]: [number, number, number, number]): Promise<string> {
  return page.evaluate(
    async ({ selector, x, y, w, h }) => {
      const c = document.querySelector<HTMLCanvasElement>(selector)!;
      const data = c.getContext("2d")!.getImageData(Math.round(x * c.width), Math.round(y * c.height), Math.round(w * c.width), Math.round(h * c.height)).data;
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    },
    { selector, x, y, w, h },
  );
}

/** Every 7th pixel of a region of the preview, small enough to compare in the test. */
async function regionPixels(page: Page, [x, y, w, h]: [number, number, number, number]): Promise<number[]> {
  return page.evaluate(
    ({ selector, x, y, w, h }) => {
      const c = document.querySelector<HTMLCanvasElement>(selector)!;
      const data = c.getContext("2d")!.getImageData(Math.round(x * c.width), Math.round(y * c.height), Math.round(w * c.width), Math.round(h * c.height)).data;
      return Array.from(data.filter((_, i) => i % 28 < 3));
    },
    { selector: PREVIEW, x, y, w, h },
  );
}

/** Real camera frames keep changing, unlike a placeholder or a frozen picture. */
async function expectFramesMoving(page: Page, region: [number, number, number, number], selector = PREVIEW) {
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        seen.add(await regionHash(page, selector, region));
        return seen.size;
      },
      { timeout: 8000, intervals: [150] },
    )
    .toBeGreaterThanOrEqual(3);
}

const OVERLAY: [number, number, number, number] = [0.78, 0.66, 0.18, 0.3];
const FULL: [number, number, number, number] = [0.2, 0.2, 0.6, 0.6];

async function studioWithDeck(page: Page) {
  const id = await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  return id;
}

async function chooseLayout(page: Page, layout: "slide-with-camera" | "slide-full" | "camera-full") {
  await page.getByTestId("tab-camera").click();
  await page.getByTestId(`layout-${layout}`).click();
}

test.describe("turning the camera on", () => {
  test("first use: choosing the camera from the dropdown, before any permission, starts it", async ({ page, context }) => {
    // What a browser reports until the first grant: empty device ids and labels.
    await context.addInitScript(() => {
      const md = navigator.mediaDevices;
      const list = md.enumerateDevices.bind(md);
      const gum = md.getUserMedia.bind(md);
      let granted = false;
      md.getUserMedia = async (c) => {
        const s = await gum(c);
        granted = true;
        return s;
      };
      md.enumerateDevices = async () => {
        const real = await list();
        return granted ? real : real.map((d) => ({ kind: d.kind, deviceId: "", groupId: "", label: "", toJSON: () => ({}) }) as MediaDeviceInfo);
      };
    });
    await studioWithDeck(page);
    await page.getByTestId("camera-select").click();
    await page.getByRole("option").first().click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
    await expectFramesMoving(page, OVERLAY);
  });

  test("choosing the camera that's already selected starts it too", async ({ page }) => {
    await studioWithDeck(page);
    await page.getByTestId("camera-select").click();
    await page.getByRole("option").first().click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  });

  test("the hint on the preview turns it on, and the Camera tab has its own toggle", async ({ page }) => {
    await studioWithDeck(page);
    await expect(page.getByTestId("camera-hint")).toContainText("Camera is off");
    await page.getByTestId("camera-hint-action").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);

    await page.getByTestId("tab-camera").click();
    await page.getByTestId("camera-panel-toggle").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "false");
    await page.getByTestId("camera-panel-toggle").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  });

  test("choosing a layout never starts the camera", async ({ page }) => {
    await studioWithDeck(page);
    for (const layout of ["camera-full", "slide-full", "slide-with-camera"] as const) {
      await chooseLayout(page, layout);
      await page.waitForTimeout(150);
      await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "false");
    }
  });

  for (const [name, message] of [
    ["NotAllowedError", /blocked/i],
    ["NotFoundError", /no camera was found/i],
    ["NotReadableError", /another app/i],
  ] as const) {
    test(`${name} is explained on the preview, and Retry works once it's resolved`, async ({ page, context }) => {
      await context.addInitScript((errorName) => {
        const md = navigator.mediaDevices;
        const gum = md.getUserMedia.bind(md);
        (window as unknown as { __fail: boolean }).__fail = true;
        md.getUserMedia = async (c) => {
          if ((window as unknown as { __fail: boolean }).__fail) throw Object.assign(new Error("injected"), { name: errorName });
          return gum(c);
        };
      }, name);
      await studioWithDeck(page);
      await page.getByTestId("camera-toggle").click();
      await expect(page.getByTestId("camera-hint")).toContainText(message);
      await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "false");

      await page.evaluate(() => void ((window as unknown as { __fail: boolean }).__fail = false));
      await page.getByTestId("camera-hint-action").click();
      await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
      await expect(page.getByTestId("camera-hint")).toHaveCount(0);
    });
  }
});

test.describe("layouts with a live camera", () => {
  test("slide + camera shows moving frames in the overlay and the slide around it", async ({ page }) => {
    await studioWithDeck(page);
    const slideRegion: [number, number, number, number] = [0.05, 0.05, 0.5, 0.5];
    const slide = await regionPixels(page, slideRegion);
    await page.getByTestId("camera-toggle").click();
    await expectFramesMoving(page, OVERLAY);
    const after = await regionPixels(page, slideRegion);
    // Slide text can come back 1/255 off between draws; anything more would be the camera bleeding in.
    expect(after.reduce((max, v, i) => Math.max(max, Math.abs(v - slide[i]!)), 0)).toBeLessThanOrEqual(2);
  });

  test("camera only shows moving frames across the canvas", async ({ page }) => {
    await studioWithDeck(page);
    await page.getByTestId("camera-toggle").click();
    await chooseLayout(page, "camera-full");
    await expectFramesMoving(page, FULL);
  });

  test("a camera hidden by Slide only says so, and Show camera brings it back", async ({ page }) => {
    await studioWithDeck(page);
    await chooseLayout(page, "slide-full");
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
    await expect(page.getByTestId("camera-hint")).toContainText("hidden by Slide only");
    await page.getByTestId("camera-hint-action").click();
    await expect(page.getByTestId("camera-hint")).toHaveCount(0);
    await expectFramesMoving(page, OVERLAY);
  });

  test("camera only with the camera off explains the empty canvas", async ({ page }) => {
    await studioWithDeck(page);
    await chooseLayout(page, "camera-full");
    await expect(page.getByTestId("camera-hint")).toContainText("Camera is off");
  });

  test("a frozen camera is named", async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { get: () => 1, configurable: true });
    });
    await studioWithDeck(page);
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-hint")).toContainText("No picture from", { timeout: 8000 });
  });
});

test.describe("reloads and session changes", () => {
  test("reload with the camera on: no phantom overlay, nothing auto-starts, and it turns back on", async ({ page }) => {
    const id = await studioWithDeck(page);
    await page.getByTestId("camera-toggle").click();
    await expectFramesMoving(page, OVERLAY);
    await page.waitForTimeout(500); // let the debounced save run
    await page.reload();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });

    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "false");
    await expect(page.getByTestId("overlay-handle")).toHaveCount(0);
    await expect(page.getByTestId("camera-hint")).toContainText("Camera is off");
    const saved = (await readSessionFromIdb(page, id))!.composition as { camera: { enabled: boolean } };
    expect(saved.camera.enabled).toBe(false);

    await page.getByTestId("camera-hint-action").click();
    await expectFramesMoving(page, OVERLAY);
  });

  test("leaving a session with the camera on doesn't carry it into the next", async ({ page }) => {
    await studioWithDeck(page);
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
    await page.getByTestId("back-to-dashboard").click();
    await page.getByTestId("new-presentation").click();
    await expect(page.getByTestId("camera-hint")).toContainText("Camera is off");
    await expect(page.getByTestId("overlay-handle")).toHaveCount(0);
  });
});

test.describe("audience window", () => {
  async function openAudience(page: Page) {
    const popup = page.context().waitForEvent("page");
    await page.getByTestId("audience-window-open").click();
    const audience = await popup;
    await audience.waitForLoadState();
    await expect.poll(() => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq())).toBeGreaterThan(0);
    return audience;
  }

  test("shows moving camera frames in slide + camera", async ({ page }) => {
    await studioWithDeck(page);
    const audience = await openAudience(page);
    await page.getByTestId("camera-toggle").click();
    await expectFramesMoving(audience, OVERLAY, "#audience-canvas");
  });

  test("keeps following the presenter after the presenter reloads", async ({ page }) => {
    await studioWithDeck(page);
    const audience = await openAudience(page);
    await page.getByTestId("slide-next").click();
    await page.getByTestId("slide-next").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("3 / 20");
    await page.reload();
    await expect(page.getByTestId("slide-counter")).toHaveText("3 / 20", { timeout: 30_000 });
    // The window is still there, and the presenter knows it.
    await expect(page.getByTestId("audience-window-open")).toHaveAttribute("data-open", "true", { timeout: 8000 });

    const before = await regionHash(audience, "#audience-canvas", [0, 0, 1, 1]);
    await page.getByTestId("slide-next").click();
    await expect.poll(() => regionHash(audience, "#audience-canvas", [0, 0, 1, 1]), { timeout: 5000 }).not.toBe(before);
  });

  test("a camera failure in the audience window is reported to the presenter, once", async ({ page, context }) => {
    await context.addInitScript(() => {
      const w = window as unknown as { __attempts: number };
      w.__attempts = 0;
      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        if (location.pathname !== "/audience.html") return gum(c);
        w.__attempts++;
        throw Object.assign(new Error("injected"), { name: "NotReadableError" });
      };
    });
    await studioWithDeck(page);
    const audience = await openAudience(page);
    await page.getByTestId("camera-toggle").click();
    await expect(page.getByTestId("audience-camera-error")).toBeVisible({ timeout: 8000 });
    await page.getByTestId("slide-next").click();
    await page.getByTestId("slide-next").click();
    await page.waitForTimeout(300);
    expect(await audience.evaluate(() => (window as unknown as { __attempts: number }).__attempts)).toBe(1);
  });
});

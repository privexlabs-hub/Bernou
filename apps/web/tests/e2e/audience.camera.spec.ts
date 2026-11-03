import { expect, test, type Page } from "@playwright/test";
import { createSessionViaUi } from "./helpers";

/**
 * Chromium may give one camera a different deviceId in each window (seen in
 * Playwright's headless Chromium). Simulated here so every browser build runs it.
 */
const rejectForeignDeviceIds = (cameraCount: number) => {
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  const list = md.enumerateDevices.bind(md);
  const w = window as unknown as { __tracks: MediaStreamTrack[] };
  w.__tracks = [];
  md.getUserMedia = async (c) => {
    if (location.pathname === "/audience.html" && (c?.video as MediaTrackConstraints)?.deviceId) {
      throw Object.assign(new Error("no such device here"), { name: "OverconstrainedError", constraint: "deviceId" });
    }
    const s = await gum(c);
    w.__tracks.push(...s.getTracks());
    return s;
  };
  if (cameraCount > 1) {
    md.enumerateDevices = async () => {
      const real = await list();
      const cam = real.find((d) => d.kind === "videoinput")!;
      return [...real, { ...cam.toJSON(), deviceId: "second-camera", toJSON: () => ({}) } as MediaDeviceInfo];
    };
  }
};

async function openWithCamera(page: Page) {
  await createSessionViaUi(page);
  const popup = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popup;
  await audience.waitForLoadState();
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  return audience;
}

const liveTracks = (p: Page) => p.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === "live").length);

test("the audience window still finds the only camera when its deviceId differs between windows", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium");
  await context.addInitScript(rejectForeignDeviceIds, 1);
  const audience = await openWithCamera(page);
  await expect.poll(() => liveTracks(audience), { timeout: 8000 }).toBe(1);
});

test("with several cameras and an unknown deviceId the audience window doesn't guess", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium");
  await context.addInitScript(rejectForeignDeviceIds, 2);
  const audience = await openWithCamera(page);
  await audience.waitForTimeout(1500);
  expect(await liveTracks(audience)).toBe(0);
});

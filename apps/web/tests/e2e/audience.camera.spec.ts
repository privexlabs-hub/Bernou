import { expect, test, type Page } from "@playwright/test";
import { createSessionViaUi } from "./helpers";

/**
 * Chromium may give one camera a different deviceId in each window (seen in
 * Playwright's headless Chromium). Simulated here so every browser build runs
 * it: the audience's first request, carrying the presenter's id, is refused.
 */
const rejectForeignDeviceId = (cameras: "one" | "two" | "masked") => {
  const md = navigator.mediaDevices;
  const gum = md.getUserMedia.bind(md);
  const list = md.enumerateDevices.bind(md);
  const w = window as unknown as { __tracks: MediaStreamTrack[]; __exactIds: unknown[]; __realId: string };
  w.__tracks = [];
  w.__exactIds = [];
  md.getUserMedia = async (c) => {
    if (location.pathname === "/audience.html") {
      const asked = ((c?.video as MediaTrackConstraints)?.deviceId as ConstrainDOMStringParameters | undefined)?.exact;
      w.__exactIds.push(asked ?? null);
      if (w.__exactIds.length === 1) throw Object.assign(new Error("no such device here"), { name: "OverconstrainedError", constraint: "deviceId" });
    }
    const s = await gum(c);
    w.__tracks.push(...s.getTracks());
    return s;
  };
  md.enumerateDevices = async () => {
    const real = await list();
    w.__realId = real.find((d) => d.kind === "videoinput")?.deviceId ?? "";
    if (cameras === "masked") return real.map((d) => ({ kind: d.kind, deviceId: "", groupId: "", label: "", toJSON: () => ({}) }) as MediaDeviceInfo);
    if (cameras === "two") return [...real, { kind: "videoinput", deviceId: "second-camera", groupId: "", label: "", toJSON: () => ({}) } as MediaDeviceInfo];
    return real;
  };
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

test("the audience window opens the only camera, by its own id, when the presenter's id means nothing there", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium");
  await context.addInitScript(rejectForeignDeviceId, "one" as const);
  const audience = await openWithCamera(page);
  await expect.poll(() => liveTracks(audience), { timeout: 8000 }).toBe(1);
  const { asked, real } = await audience.evaluate(() => {
    const w = window as unknown as { __exactIds: unknown[]; __realId: string };
    return { asked: w.__exactIds[1], real: w.__realId };
  });
  expect(real).toBeTruthy();
  expect(asked).toBe(real); // never an unconstrained "any camera" request
});

for (const cameras of ["two", "masked"] as const) {
  test(`with an unmatched id and a ${cameras} camera list, the audience window doesn't guess, and says so`, async ({ page, browserName, context }) => {
    test.skip(browserName !== "chromium");
    await context.addInitScript(rejectForeignDeviceId, cameras);
    const audience = await openWithCamera(page);
    await expect(page.getByTestId("audience-camera-error")).toContainText("can't tell which camera", { timeout: 8000 });
    expect(await liveTracks(audience)).toBe(0);
  });
}

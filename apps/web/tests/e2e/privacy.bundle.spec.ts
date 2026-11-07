import { expect, test } from "@playwright/test";

/**
 * Regression for a real bug caught during step 2.4: a shared Rollup chunk
 * once pulled the audience bootstrap into the presenter page, so audience
 * code executed inside the private workspace. The two pages must stay
 * separate in both directions.
 * @nomedia
 */
test("presenter page never executes audience bootstrap, and vice versa @nomedia", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const loaded: string[] = [];
  page.on("response", (r) => r.url().includes("/assets/") && r.url().endsWith(".js") && loaded.push(r.url().split("/assets/")[1]!));

  await page.goto("/");
  await expect(page.getByTestId("new-presentation")).toBeVisible();
  expect(errors).toEqual([]);
  // The presenter must not load the audience entry chunk.
  expect(loaded.some((f) => /^audience-(?!core)/.test(f))).toBe(false);

  const audienceLoaded: string[] = [];
  const audience = await page.context().newPage();
  audience.on("response", (r) => r.url().includes("/assets/") && r.url().endsWith(".js") && audienceLoaded.push(r.url().split("/assets/")[1]!));
  await audience.goto("/audience.html");
  await expect(audience.locator("canvas")).toHaveCount(1);
  // The audience page must not load the presenter entry chunk (React app).
  expect(audienceLoaded.some((f) => /^presenter-/.test(f))).toBe(false);
  expect(await audience.locator("body").innerText()).toBe("");
});

/** The editor's media libraries (several MB) load only when the editor is opened. @nomedia */
test("the dashboard, studio and audience window don't load the editor or its libraries @nomedia", async ({ page }) => {
  const loaded: string[] = [];
  const track = (p: typeof page) => p.on("response", (r) => r.url().includes("/assets/") && loaded.push(r.url().split("/assets/")[1]!));
  track(page);
  await page.goto("/");
  await page.getByTestId("new-presentation").click();
  await expect(page.getByTestId("studio")).toBeVisible();
  await page.waitForTimeout(500);
  const audience = await page.context().newPage();
  track(audience);
  await audience.goto("/audience.html");
  await expect(audience.locator("canvas")).toHaveCount(1);
  expect(loaded.filter((f) => /^(EditorPage|exportWorker|workletProcessor|rnnoise)/.test(f))).toEqual([]);
});

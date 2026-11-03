import { expect, test } from "@playwright/test";
import { createSessionViaUi } from "./helpers";

const CANARY = "CANARY-PREVIOUS-SESSION-7c1d";

/** One session's private script must never be on screen in another. @nomedia */
test("a new session never shows the previous session's script, even briefly @nomedia", async ({ page }) => {
  await createSessionViaUi(page);
  await page.getByTestId("script-paste").fill(`Opening line. ${CANARY}`);
  await page.getByTestId("script-paste-commit").click();
  await expect(page.getByTestId("script-section")).toHaveCount(1);
  await expect(page.getByTestId("script-editor")).toContainText("Saved");

  // Sample every frame from before leaving until the next session has settled.
  await page.evaluate((canary) => {
    const w = window as unknown as { __leaks: string[] };
    w.__leaks = [];
    const start = location.pathname;
    const sample = () => {
      const shown = [...document.querySelectorAll("textarea")].map((t) => t.value).join("") + document.body.innerText;
      if (location.pathname !== start && location.pathname !== "/" && shown.includes(canary)) w.__leaks.push(location.pathname);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, CANARY);

  await page.getByTestId("back-to-dashboard").click();
  await page.getByTestId("new-presentation").click();
  await expect(page).toHaveURL(/\/studio\//);
  await expect(page.getByTestId("script-paste")).toBeVisible();
  await page.waitForTimeout(500);

  expect(await page.evaluate(() => (window as unknown as { __leaks: string[] }).__leaks)).toEqual([]);
  await expect(page.getByTestId("script-paste")).toHaveValue("");
});

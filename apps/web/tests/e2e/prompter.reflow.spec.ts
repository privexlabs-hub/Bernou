import { expect, test, type Page } from "@playwright/test";
import { createSessionViaUi } from "./helpers";
import { fillNumberedScript, wordAtReadingLine } from "./prompterHelpers";

const scrollTop = (page: Page) => page.getByTestId("prompter-viewport").evaluate((el) => el.scrollTop);

async function deepInTheScript(page: Page) {
  await createSessionViaUi(page);
  await fillNumberedScript(page);
  await page.getByTestId("tab-prompter").click();
  await page.getByTestId("prompter-viewport").evaluate((el) => (el.scrollTop = 9000));
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(8000);
}

test.describe("the reading place when the text rewraps @nomedia", () => {
  test("a narrower window keeps the same words on the line @nomedia", async ({ page }) => {
    await deepInTheScript(page);
    const before = await wordAtReadingLine(page);

    await page.setViewportSize({ width: 800, height: 720 });
    await page.waitForTimeout(400);

    expect(Math.abs((await wordAtReadingLine(page)) - before)).toBeLessThan(40);
  });

  test("a bigger font keeps the same words on the line @nomedia", async ({ page }) => {
    await deepInTheScript(page);
    const before = await wordAtReadingLine(page);

    await page.getByTestId("prompter-settings-toggle").click();
    await page.getByTestId("prompter-font-size").getByRole("slider").focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);

    expect(Math.abs((await wordAtReadingLine(page)) - before)).toBeLessThan(40);
  });

  test("resizing while playing keeps the place and keeps moving @nomedia", async ({ page }) => {
    await deepInTheScript(page);
    const before = await wordAtReadingLine(page);
    await page.getByTestId("prompter-toggle").click();
    await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "playing");

    for (const width of [1100, 900, 800]) {
      await page.setViewportSize({ width, height: 720 });
      await page.waitForTimeout(150);
    }
    const after = await wordAtReadingLine(page);
    expect(after).toBeGreaterThanOrEqual(before - 40);
    expect(after).toBeLessThan(before + 80); // about a second of scrolling, at 40 px/s

    const top = await scrollTop(page);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(top + 10);
    await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "playing");
  });

  test("scrolling by hand after a rewrap isn't undone by it @nomedia", async ({ page }) => {
    await deepInTheScript(page);
    await page.setViewportSize({ width: 800, height: 720 });
    await page.waitForTimeout(300);
    const top = await scrollTop(page);
    await page.getByTestId("prompter-viewport").evaluate((el, t) => (el.scrollTop = t), top - 2000);
    await page.waitForTimeout(300);
    expect(Math.abs((await scrollTop(page)) - (top - 2000))).toBeLessThan(2);
  });
});

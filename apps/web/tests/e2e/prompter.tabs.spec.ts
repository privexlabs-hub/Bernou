import { expect, test, type Page } from "@playwright/test";
import { createSessionViaUi } from "./helpers";

const SPEECH = Array.from({ length: 30 }, (_, i) => `Section ${i + 1}. ${"The quick brown fox jumps over the lazy dog. ".repeat(6)}`).join("\n\n");

const scrollTop = (page: Page) => page.getByTestId("prompter-viewport").evaluate((el) => el.scrollTop);
const status = (page: Page) => page.getByTestId("teleprompter");

async function withScript(page: Page) {
  await createSessionViaUi(page);
  await page.getByTestId("script-paste").fill(SPEECH);
  await page.getByTestId("script-paste-commit").click();
  await page.getByTestId("tab-prompter").click();
}

async function playPast(page: Page, px: number) {
  await page.getByTestId("prompter-toggle").click();
  await expect(status(page)).toHaveAttribute("data-status", "playing");
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(px);
}

test.describe("switching tabs while the prompter plays @nomedia", () => {
  for (const tab of ["script", "notes", "camera"] as const) {
    test(`to ${tab} and back: holds its place, then carries on @nomedia`, async ({ page }) => {
      await withScript(page);
      await playPast(page, 60);

      const left = await scrollTop(page);
      await page.getByTestId(`tab-${tab}`).click();
      await page.waitForTimeout(1500); // 60px of scrolling at the default speed, if it kept going
      await page.getByTestId("tab-prompter").click();

      const back = await scrollTop(page);
      expect(back).toBeGreaterThanOrEqual(left);
      expect(back).toBeLessThan(left + 45);
      await expect(status(page)).toHaveAttribute("data-status", "playing");
      await expect.poll(() => scrollTop(page)).toBeGreaterThan(back + 20);
    });
  }

  test("paused stays paused at the same place @nomedia", async ({ page }) => {
    await withScript(page);
    await playPast(page, 60);
    await page.getByTestId("prompter-toggle").click();
    await expect(status(page)).toHaveAttribute("data-status", "paused");
    const left = await scrollTop(page);
    await page.getByTestId("tab-script").click();
    await page.waitForTimeout(300);
    await page.getByTestId("tab-prompter").click();
    expect(await scrollTop(page)).toBe(left);
    await expect(status(page)).toHaveAttribute("data-status", "paused");
  });

  test("the hidden prompter can't take focus, and Space leaves it alone @nomedia", async ({ page }) => {
    await withScript(page);
    await page.getByTestId("tab-script").click();
    const focused = await page.getByTestId("prompter-viewport").evaluate((el: HTMLElement) => {
      el.focus();
      return document.activeElement === el;
    });
    expect(focused).toBe(false);
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    await expect(status(page)).toHaveAttribute("data-status", "idle");
  });
});

test("the end of the script reaches the reading line @nomedia", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 }); // tall, narrow panel
  await withScript(page);
  const gap = await page.getByTestId("prompter-viewport").evaluate(async (el) => {
    el.scrollTop = el.scrollHeight;
    await new Promise((r) => setTimeout(r, 100));
    const line = document.querySelector('[data-testid="prompter-reading-line"]')!.getBoundingClientRect().top;
    const sections = el.querySelectorAll('[data-testid="prompter-section"] p');
    return sections[sections.length - 1]!.getBoundingClientRect().bottom - line;
  });
  expect(Math.abs(gap)).toBeLessThan(60); // the last line sits at the line, give or take its height
});

test("a new session starts at the top, not where the last one was @nomedia", async ({ page }) => {
  await withScript(page);
  await playPast(page, 60);
  await page.getByTestId("back-to-dashboard").click();
  await page.getByTestId("new-presentation").click();
  await page.getByTestId("script-paste").fill(SPEECH);
  await page.getByTestId("script-paste-commit").click();
  await page.getByTestId("tab-prompter").click();
  await expect(status(page)).toHaveAttribute("data-status", "idle");
  expect(await scrollTop(page)).toBe(0);
});

test("deleting every section stops a playing prompter @nomedia", async ({ page }) => {
  await withScript(page);
  await playPast(page, 20);
  await page.getByTestId("tab-script").click();
  await page.getByTestId("section-delete").first().click();
  await page.getByTestId("tab-prompter").click();
  await expect(status(page)).toHaveAttribute("data-status", "idle");
});

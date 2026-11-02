import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi, readSessionFromIdb } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));
const SPEECH = Array.from({ length: 60 }, (_, i) => `Section ${i + 1}. ${"The quick brown fox jumps over the lazy dog. ".repeat(6)}`).join("\n\n");

const scrollTop = (page: Page) => page.getByTestId("prompter-viewport").evaluate((el) => el.scrollTop);

async function setup(page: Page) {
  const id = await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  await page.getByTestId("tab-script").click();
  await page.getByTestId("script-paste").fill(SPEECH);
  await page.getByTestId("script-paste-commit").click();
  await page.getByTestId("section-split").first().click();
  await expect(page.getByTestId("script-section")).toHaveCount(60);
  await page.getByTestId("tab-prompter").click();
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "idle");
  return id;
}

/** AC4 — A user can control teleprompter scrolling. @nomedia */
test("start, pause, resume, stop, reset and speed via buttons @nomedia", async ({ page }) => {
  await setup(page);
  expect(await scrollTop(page)).toBe(0);

  await page.getByTestId("prompter-toggle").click();
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "playing");
  await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(10);

  // pause holds position
  await page.getByTestId("prompter-toggle").click();
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "paused");
  const atPause = await scrollTop(page);
  await page.waitForTimeout(400);
  expect(Math.abs((await scrollTop(page)) - atPause)).toBeLessThan(2);

  // resume continues from there
  await page.getByTestId("prompter-toggle").click();
  await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(atPause + 10);

  // faster → bigger distance over the same time
  await page.getByTestId("prompter-faster").click();
  await page.getByTestId("prompter-faster").click();
  await expect(page.getByTestId("prompter-speed")).toContainText("50");

  // stop keeps position; reset goes to top
  await page.getByTestId("prompter-stop").click();
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "idle");
  expect(await scrollTop(page)).toBeGreaterThan(10);
  await page.getByTestId("prompter-reset").click();
  await expect.poll(() => scrollTop(page)).toBe(0);
});

test("keyboard shortcuts and manual scrolling @nomedia", async ({ page }) => {
  await setup(page);
  const vp = page.getByTestId("prompter-viewport");

  // global Space toggles even when focus is on the body
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "playing");
  await page.keyboard.press("Space");
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "paused");

  // inside the viewport, arrows control speed and nudge — and do NOT change the slide
  await vp.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("prompter-speed")).toContainText("45");
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("prompter-speed")).toContainText("40");

  const before = await scrollTop(page);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 30);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => scrollTop(page)).toBeLessThan(before + 30);

  // wheel scrolls manually
  const box = (await vp.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(200);

  await page.keyboard.press("Home");
  await expect.poll(() => scrollTop(page)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "idle");
});

test("font size, colours and alignment persist; follow-slides jumps to a linked section @nomedia", async ({ page }) => {
  const id = await setup(page);
  await page.getByTestId("prompter-settings-toggle").click();
  const slider = page.getByTestId("prompter-font-size").getByRole("slider");
  await slider.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  const fontPx = await page.getByTestId("prompter-section").first().evaluate((el) => parseFloat(getComputedStyle(el.parentElement!).fontSize));
  expect(fontPx).toBe(36);

  await page.getByRole("tab", { name: "Centre" }).click();
  // wait for the debounced write to commit before reloading
  await expect.poll(async () => (await readSessionFromIdb(page, id))?.teleprompter, { timeout: 5000 }).toMatchObject({ fontSize: 36, align: "center" });
  await page.reload();
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 15_000 });
  await page.getByTestId("tab-prompter").click();
  const after = await page.getByTestId("prompter-section").first().evaluate((el) => {
    const cs = getComputedStyle(el.parentElement!);
    return [parseFloat(cs.fontSize), cs.textAlign];
  });
  expect(after).toEqual([36, "center"]);

  // link section 30 to slide 5; moving to slide 5 scrolls the prompter there
  await page.getByTestId("tab-script").click();
  const sec30 = page.getByTestId("script-section").nth(29);
  await sec30.scrollIntoViewIfNeeded();
  await sec30.getByTestId("section-slide").click();
  await page.getByRole("option", { name: "Slide 5" }).click();
  await page.getByTestId("tab-prompter").click();
  expect(await scrollTop(page)).toBe(0);
  await page.getByRole("button", { name: "Slide 5" }).click();
  await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(1000);
  await expect(page.getByTestId("prompter-section").nth(29)).toHaveAttribute("data-current", "true");
});

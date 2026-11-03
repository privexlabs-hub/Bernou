import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi, readSessionFromIdb } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));
const SPEECH = Array.from({ length: 12 }, (_, i) => `Section ${i + 1}. ${"The quick brown fox jumps over the lazy dog. ".repeat(10)}`).join("\n\n");

const scrollTop = (page: Page) => page.getByTestId("prompter-viewport").evaluate((el) => el.scrollTop);

async function setup(page: Page) {
  const id = await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  await page.getByTestId("script-paste").fill(SPEECH);
  await page.getByTestId("script-paste-commit").click();
  await page.getByTestId("section-split").first().click();
  await expect(page.getByTestId("script-section")).toHaveCount(12);
  return id;
}

async function link(page: Page, section: number, slide: number) {
  await page.getByTestId("tab-script").click();
  const card = page.getByTestId("script-section").nth(section);
  await card.scrollIntoViewIfNeeded();
  await card.getByTestId("section-slide").click();
  await page.getByRole("option", { name: `Slide ${slide}`, exact: true }).click();
}

async function openSettings(page: Page) {
  await page.getByTestId("tab-prompter").click();
  if (!(await page.getByTestId("prompter-settings").isVisible())) await page.getByTestId("prompter-settings-toggle").click();
}

const goToSlide = (page: Page, n: number) => page.getByRole("button", { name: `Slide ${n}`, exact: true }).click();

test.describe("speed @nomedia", () => {
  test("goes down to 1 and still scrolls @nomedia", async ({ page }) => {
    await setup(page);
    await page.getByTestId("tab-prompter").click();
    await expect(page.getByTestId("prompter-speed")).toHaveText("40");
    for (let i = 0; i < 6; i++) await page.getByTestId("prompter-slower").click();
    await expect(page.getByTestId("prompter-speed")).toHaveText("10");
    await page.getByTestId("prompter-slower").click();
    await expect(page.getByTestId("prompter-speed")).toHaveText("9");
    for (let i = 0; i < 12; i++) await page.getByTestId("prompter-slower").click();
    await expect(page.getByTestId("prompter-speed")).toHaveText("1");
    await page.getByTestId("prompter-toggle").click();
    await expect.poll(() => scrollTop(page), { timeout: 5000 }).toBeGreaterThan(0.9);
    await page.getByTestId("prompter-faster").click();
    await expect(page.getByTestId("prompter-speed")).toHaveText("2");
  });

  test("the settings slider reaches the same limits as the buttons @nomedia", async ({ page }) => {
    await setup(page);
    await openSettings(page);
    const slider = page.getByTestId("prompter-speed-slider").getByRole("slider");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("prompter-speed")).toHaveText("1");
    await page.keyboard.press("End");
    await expect(page.getByTestId("prompter-speed")).toHaveText("400");
  });
});

test.describe("follow slides is optional @nomedia", () => {
  test("off by default: links do nothing to the prompter @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 8, 5);
    await page.getByTestId("tab-prompter").click();
    await goToSlide(page, 5);
    await page.waitForTimeout(300);
    expect(await scrollTop(page)).toBe(0);
  });

  test("on: jumps to the linked section, and it's remembered @nomedia", async ({ page }) => {
    const id = await setup(page);
    await link(page, 8, 5);
    await openSettings(page);
    await page.getByTestId("prompter-follow").click();
    await goToSlide(page, 5);
    await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(500);
    await expect(page.getByTestId("prompter-section").nth(8)).toHaveAttribute("data-current", "true");
    await expect.poll(async () => (await readSessionFromIdb(page, id))?.teleprompter, { timeout: 5000 }).toMatchObject({ followSlides: true });

    await page.reload();
    await expect(page.getByTestId("slide-counter")).toContainText("/ 20", { timeout: 15_000 });
    await openSettings(page);
    await expect(page.getByTestId("prompter-follow")).toBeChecked();
  });

  test("turning it on goes to the current slide's section straight away @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 8, 1);
    await openSettings(page);
    expect(await scrollTop(page)).toBe(0);
    await page.getByTestId("prompter-follow").click();
    await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(500);
  });

  test("slides with no link leave the prompter alone, also while playing or paused @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 8, 5);
    await openSettings(page);
    await page.getByTestId("prompter-follow").click();

    await goToSlide(page, 3); // no link
    await page.waitForTimeout(200);
    expect(await scrollTop(page)).toBe(0);

    await page.getByTestId("prompter-toggle").click(); // playing
    await goToSlide(page, 5);
    await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(500);
    await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "playing");

    await page.getByTestId("prompter-toggle").click(); // paused
    await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "paused");
    await goToSlide(page, 1);
    await page.waitForTimeout(200);
    await goToSlide(page, 5);
    await expect(page.getByTestId("teleprompter")).toHaveAttribute("data-status", "paused");
  });

  test("several sections on one slide: the first is used, and it never changes the slide @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 4, 5);
    await link(page, 9, 5);
    await openSettings(page);
    await page.getByTestId("prompter-follow").click();
    await goToSlide(page, 5);
    await expect(page.getByTestId("prompter-section").nth(4)).toHaveAttribute("data-current", "true");
    await page.getByTestId("prompter-toggle").click();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("slide-counter")).toHaveText("5 / 20");
  });

  test("a slide changed from another tab is followed @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 8, 5);
    await openSettings(page);
    await page.getByTestId("prompter-follow").click();
    await page.getByTestId("tab-script").click();
    await goToSlide(page, 5);
    await page.getByTestId("tab-prompter").click();
    await expect.poll(() => scrollTop(page), { timeout: 3000 }).toBeGreaterThan(500);
  });

  test("explains itself, including when nothing is linked @nomedia", async ({ page }) => {
    await setup(page);
    await openSettings(page);
    await expect(page.getByTestId("prompter-follow-help")).toContainText("No sections are linked yet");
    await link(page, 2, 3);
    await openSettings(page);
    await expect(page.getByTestId("prompter-follow-help")).toContainText("jump to the section linked to it");
    await page.getByTestId("tab-script").click();
    await expect(page.getByTestId("script-links-help")).toContainText("optional");
  });
});

test.describe("slide links are optional @nomedia", () => {
  test("new sections have no slide, and all sections show in the prompter in order @nomedia", async ({ page }) => {
    await setup(page);
    await page.getByTestId("section-add-after").first().click();
    await expect(page.getByTestId("script-section")).toHaveCount(13);
    await expect(page.getByTestId("section-slide").nth(1)).toContainText("No slide");
    await page.getByTestId("section-body").nth(1).fill("Added later");
    await page.getByTestId("tab-prompter").click();
    await expect(page.getByTestId("prompter-section")).toHaveCount(13);
    await expect(page.getByTestId("prompter-section").nth(1)).toContainText("Added later");
    await expect(page.getByTestId("prompter-section").nth(0)).toContainText("Section 1.");
  });

  test("an untitled section still shows its slide in the prompter @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 0, 3);
    await page.getByTestId("tab-prompter").click();
    await expect(page.getByTestId("prompter-section").first()).toContainText("slide 3");
    await expect(page.getByTestId("prompter-section").nth(1)).not.toContainText("slide ");
  });

  test("a link survives a reload @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 3, 7);
    await expect(page.getByTestId("script-save-state")).toHaveText("Saved", { timeout: 5000 });
    await page.reload();
    await expect(page.getByTestId("slide-counter")).toContainText("/ 20", { timeout: 15_000 });
    await expect(page.getByTestId("section-slide").nth(3)).toContainText("Slide 7");
  });

  test("a link past the end of the deck can be seen and cleared @nomedia", async ({ page }) => {
    await setup(page);
    await link(page, 0, 12);
    await expect(page.getByTestId("script-save-state")).toHaveText("Saved", { timeout: 5000 });
    await page.getByTestId("studio-import-input").setInputFiles(fileURLToPath(new URL("../../../../fixtures/decks/notes-pages.pdf", import.meta.url)));
    await page.getByTestId("replace-keep").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 30_000 });

    const trigger = page.getByTestId("section-slide").first();
    await expect(trigger).toContainText("Slide 12");
    await trigger.click();
    await expect(page.getByRole("option", { name: "Slide 12 (not in this deck)" })).toBeVisible();
    await page.getByRole("option", { name: "No slide" }).click();
    await expect(trigger).toContainText("No slide");
  });

  test("with no slides there's nothing to link to, and no slide-0 ghost in Notes @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await page.getByTestId("script-paste").fill("Just a speech.");
    await page.getByTestId("script-paste-commit").click();
    await page.getByTestId("section-slide").click();
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.getByTestId("tab-notes").click();
    await expect(page.getByTestId("notes-panel")).toContainText("no slides yet");
    await expect(page.getByTestId("notes-linked-section")).toHaveCount(0);
  });
});

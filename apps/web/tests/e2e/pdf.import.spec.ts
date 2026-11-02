import { expect, test } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi, waitForSessionField } from "./helpers";

const deck = (name: string) => fileURLToPath(new URL(`../../../../fixtures/decks/${name}`, import.meta.url));

/** AC2 — A user can import and navigate presentation slides. */
test("import a 20-page PDF and navigate with buttons, thumbnails and keys", async ({ page }) => {
  const id = await createSessionViaUi(page);
  await expect(page.getByTestId("studio")).toHaveAttribute("data-loading", "false");

  await page.getByTestId("studio-import-input").setInputFiles(deck("lecture-20.pdf"));
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  await expect(page.getByTestId("slide-thumbs").locator("li")).toHaveCount(20);
  await expect(page.getByTestId("import-warning")).toHaveCount(0);

  await page.getByTestId("slide-next").click();
  await expect(page.getByTestId("slide-counter")).toHaveText("2 / 20");
  await page.getByTestId("slide-prev").click();
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20");
  await expect(page.getByTestId("slide-prev")).toBeDisabled();

  // keyboard: body must have focus, not an input
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("slide-counter")).toHaveText("3 / 20");
  await page.keyboard.press("End");
  await expect(page.getByTestId("slide-counter")).toHaveText("20 / 20");
  await expect(page.getByTestId("slide-next")).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20");

  await page.getByRole("button", { name: "Slide 7" }).click();
  await expect(page.getByTestId("slide-counter")).toHaveText("7 / 20");

  // persists across reload — first prove the write committed to IndexedDB
  await waitForSessionField(page, id, "activeSlideIndex", 6);
  await page.reload();
  await expect(page.getByTestId("slide-counter")).toHaveText("7 / 20", { timeout: 15_000 });
  await expect(page.getByTestId("slide-thumbs").locator("li")).toHaveCount(20);
});

/** Importing from the dashboard goes through the same pipeline. */
test("import from the dashboard creates a titled session with slides", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("import-file-input").setInputFiles(deck("lecture-20.pdf"));
  await expect(page).toHaveURL(/\/studio\//);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
  await expect(page.getByTestId("studio-title")).toHaveValue("lecture-20");
});

/** P8 — a "Notes Pages" PDF triggers a warning that printed notes would be visible. */
test("notes-pages PDF triggers a privacy warning", async ({ page }) => {
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck("notes-pages.pdf"));
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 30_000 });
  await expect(page.getByTestId("import-warning")).toContainText("Notes Pages");
});

/** PPTX is refused with guidance in the MVP, never silently mangled. */
test("pptx shows export-to-PDF guidance instead of importing", async ({ page }) => {
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles({
    name: "deck.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("PK\u0003\u0004fake"),
  });
  await expect(page.getByTestId("pptx-guidance")).toBeVisible();
  await expect(page.getByTestId("slide-counter")).toHaveText("—");
});

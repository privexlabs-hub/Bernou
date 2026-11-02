import { expect, test } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";
import { createSessionViaUi } from "./helpers";

const deck = fileURLToPath(new URL("../../../../fixtures/decks/lecture-20.pdf", import.meta.url));

// A ~10k-word speech: 400 paragraphs of 25 words.
const SPEECH = Array.from({ length: 400 }, (_, i) => `Paragraph ${i + 1}: ${"lorem ipsum dolor sit amet consectetur ".repeat(4)}end.`).join("\n\n");

/** AC3 — A user can paste and edit a speech. @nomedia */
test("paste a 10k-word speech, split into sections, edit, link to a slide, survives reload @nomedia", async ({ page }) => {
  await createSessionViaUi(page);
  await page.getByTestId("studio-import-input").setInputFiles(deck);
  await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });

  await page.getByTestId("tab-script").click();
  await page.getByTestId("script-paste").fill(SPEECH);
  await page.getByTestId("script-paste-commit").click();
  await expect(page.getByTestId("script-section")).toHaveCount(1);
  await expect(page.getByTestId("script-editor")).toContainText("10800 words");

  // split at blank lines → 400 sections
  await page.getByTestId("section-split").first().click();
  await expect(page.getByTestId("script-section")).toHaveCount(400);

  // edit the first section's title and body
  const first = page.getByTestId("script-section").first();
  await first.getByTestId("section-title").fill("Opening");
  await first.getByTestId("section-body").fill("Good morning everyone. CANARY-SCRIPT-9f2c");
  // link it to slide 3
  await first.getByTestId("section-slide").click();
  await page.getByRole("option", { name: "Slide 3" }).click();
  await expect(page.getByTestId("script-save-state")).toHaveText("Saved", { timeout: 5000 });

  // notes for slide 3 show the linked section
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.getByTestId("tab-notes").click();
  await expect(page.getByTestId("notes-panel")).toContainText("Notes for slide 3 of 20");
  await expect(page.getByTestId("notes-linked-section")).toContainText("Opening");

  // write a note for slide 3
  await page.getByTestId("notes-body").fill("Remember the grant deadline. CANARY-NOTES-4a71");
  await expect(page.getByTestId("notes-save-state")).toHaveText("Saved", { timeout: 5000 });

  await page.reload();
  await expect(page.getByTestId("slide-counter")).toHaveText("3 / 20", { timeout: 15_000 });
  await page.getByTestId("tab-script").click();
  await expect(page.getByTestId("script-section")).toHaveCount(400);
  await expect(page.getByTestId("script-section").first().getByTestId("section-title")).toHaveValue("Opening");
  await expect(page.getByTestId("script-section").first().getByTestId("section-body")).toHaveValue(/Good morning everyone/);
  await page.getByTestId("tab-notes").click();
  await expect(page.getByTestId("notes-body")).toHaveValue(/grant deadline/);

  // the saved script shows on the dashboard
  await page.goto("/");
  await expect(page.getByTestId("saved-scripts")).toContainText("words");
});

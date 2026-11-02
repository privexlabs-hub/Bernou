import { expect, test } from "@playwright/test";
import { createSessionViaUi } from "./helpers";

/** AC1 — A user can create a presentation session. @nomedia */
test("create a session, it appears in Recent and survives a reload @nomedia", async ({ page }) => {
  const id = await createSessionViaUi(page);

  await page.goto("/");
  const cards = page.getByTestId("session-card");
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId("session-title")).toHaveText("Untitled presentation");

  await page.reload();
  await expect(page.getByTestId("session-card")).toHaveCount(1);

  // rename from the card menu
  await page.getByTestId("session-menu").click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByTestId("session-rename-input").fill("Thermodynamics L3");
  await page.getByTestId("session-rename-input").press("Enter");
  await expect(page.getByTestId("session-title")).toHaveText("Thermodynamics L3");

  // opens the same session
  await page.getByTestId("session-title").click();
  await expect(page).toHaveURL(new RegExp(`/studio/${id}$`));
});

test("delete removes the session after confirmation @nomedia", async ({ page }) => {
  await createSessionViaUi(page);
  await page.goto("/");
  await page.getByTestId("session-menu").click();
  await page.getByTestId("session-delete").click();
  await page.getByTestId("session-delete-confirm").click();
  await expect(page.getByTestId("session-card")).toHaveCount(0);
  await expect(page.getByText("No presentations yet.")).toBeVisible();
});

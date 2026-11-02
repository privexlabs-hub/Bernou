import { expect, type Page } from "@playwright/test";

/** Create a session from the dashboard and land in the studio. Returns the session id. */
export async function createSessionViaUi(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByTestId("new-presentation").click();
  await expect(page).toHaveURL(/\/studio\/[A-Za-z0-9]+$/);
  return page.url().split("/studio/")[1]!;
}

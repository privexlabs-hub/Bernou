import { expect, type Page } from "@playwright/test";

/** Create a session from the dashboard and land in the studio. Returns the session id. */
export async function createSessionViaUi(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByTestId("new-presentation").click();
  await expect(page).toHaveURL(/\/studio\/[A-Za-z0-9]+$/);
  return page.url().split("/studio/")[1]!;
}

/** Read a session record straight from IndexedDB (bypasses the app) — proves a write committed. */
export async function readSessionFromIdb(page: Page, id: string): Promise<{ activeSlideIndex: number; title: string; slideCount: number } | null> {
  return page.evaluate(
    (sessionId) =>
      new Promise((resolve) => {
        const req = indexedDB.open("bernou");
        req.onerror = () => resolve(null);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("sessions", "readonly");
          const get = tx.objectStore("sessions").get(sessionId);
          get.onsuccess = () => {
            const r = get.result;
            db.close();
            resolve(r ? { activeSlideIndex: r.activeSlideIndex, title: r.title, slideCount: r.slideCount } : null);
          };
          get.onerror = () => resolve(null);
        };
      }),
    id,
  );
}

export async function waitForSessionField(page: Page, id: string, field: "activeSlideIndex" | "slideCount", value: number) {
  await expect.poll(async () => (await readSessionFromIdb(page, id))?.[field], { timeout: 5000 }).toBe(value);
}

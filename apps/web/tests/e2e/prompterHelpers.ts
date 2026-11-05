import { expect, type Page } from "@playwright/test";

/** 30 sections of 120 numbered words, so a test can tell exactly which words are showing. */
export const NUMBERED_SCRIPT = Array.from({ length: 30 }, (_, s) =>
  Array.from({ length: 120 }, (_, w) => `w${s * 120 + w}`).join(" "),
).join("\n\n");

export async function fillNumberedScript(page: Page) {
  await page.getByTestId("script-paste").fill(NUMBERED_SCRIPT);
  await page.getByTestId("script-paste-commit").click();
  await expect(page.getByTestId("script-section").first()).toBeVisible();
  await page.getByTestId("section-split").first().click();
  await expect(page.getByTestId("script-section")).toHaveCount(30);
}

/** The number of the word under the reading line. `page` is whichever window holds the text. */
export async function wordAtReadingLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const vp = doc.querySelector('[data-testid="prompter-viewport"]')!.getBoundingClientRect();
    const y = doc.querySelector('[data-testid="prompter-reading-line"]')!.getBoundingClientRect().top;
    // The line can fall between two lines of text, or below a section's end: look just under it.
    for (let dy = 0; dy < 200; dy += 4) {
      const x = vp.left + 40;
      let node: Node | null = null;
      let offset = 0;
      if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(x, y + dy);
        node = r?.startContainer ?? null;
        offset = r?.startOffset ?? 0;
      } else {
        const p = doc.caretPositionFromPoint?.(x, y + dy);
        node = p?.offsetNode ?? null;
        offset = p?.offset ?? 0;
      }
      const text = node?.nodeType === Node.TEXT_NODE ? node.textContent ?? "" : "";
      const match = /w(\d+)/.exec(text.slice(offset));
      if (match) return Number(match[1]);
    }
    throw new Error("no word near the reading line");
  });
}

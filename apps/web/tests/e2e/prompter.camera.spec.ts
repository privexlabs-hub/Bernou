import { expect, test, type Page } from "@playwright/test";
import { createSessionViaUi, readSessionFromIdb } from "./helpers";
import { fillNumberedScript, wordAtReadingLine } from "./prompterHelpers";

/** The text's layout in whichever window `page` is. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const vp = document.querySelector('[data-testid="prompter-viewport"]')!.getBoundingClientRect();
    const line = document.querySelector('[data-testid="prompter-reading-line"]')!.getBoundingClientRect().top;
    const section = getComputedStyle(document.querySelector('[data-testid="prompter-section"]')!);
    return { fontSize: parseFloat(section.fontSize), align: section.textAlign, line: (line - vp.top) / vp.height };
  });

async function withScript(page: Page) {
  const id = await createSessionViaUi(page);
  await fillNumberedScript(page);
  await page.getByTestId("tab-prompter").click();
  return id;
}

async function openFloat(page: Page) {
  const opened = page.context().waitForEvent("page");
  await page.getByTestId("prompter-float").click();
  const pip = await opened;
  await pip.setViewportSize({ width: 380, height: 200 });
  await expect(pip.getByTestId("float-prompter")).toBeVisible();
  return pip;
}

async function closeFloat(page: Page, pip: Page) {
  const closed = pip.waitForEvent("close");
  await page.getByTestId("prompter-bring-back").click();
  await closed;
  await expect(page.getByTestId("prompter-viewport")).toBeVisible();
}

async function nudgeFontSize(page: Page, steps: number) {
  await page.getByTestId("prompter-font-size").getByRole("slider").focus();
  for (let i = 0; i < Math.abs(steps); i++) await page.keyboard.press(steps > 0 ? "ArrowRight" : "ArrowLeft");
}

test.describe("the floating prompter's camera layout @nomedia", () => {
  test.skip(({ browserName }) => browserName === "webkit", "Safari has no floating window: the panel is tested below");

  test("asks for a small window, and opens with the line near the top, smaller and centred @nomedia", async ({ page }) => {
    await page.addInitScript(() => {
      const pip = (window as unknown as { documentPictureInPicture: { requestWindow: (o: unknown) => Promise<Window> } }).documentPictureInPicture;
      const real = pip.requestWindow.bind(pip);
      pip.requestWindow = (o) => {
        (window as unknown as { __asked: unknown }).__asked = o;
        return real(o);
      };
    });
    await withScript(page);
    const pip = await openFloat(page);
    expect(await page.evaluate(() => (window as unknown as { __asked: unknown }).__asked)).toEqual({ width: 380, height: 200 });

    const l = await layout(pip);
    expect(l.fontSize).toBe(22);
    expect(l.align).toBe("center");
    expect(Math.abs(l.line - 0.1)).toBeLessThan(0.02);
  });

  test("the tab keeps its own layout @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await closeFloat(page, pip);
    const l = await layout(page);
    expect(l.fontSize).toBe(28);
    expect(l.align).toBe("left");
    expect(Math.abs(l.line - 0.35)).toBeLessThan(0.02);
  });

  test("while floating, the settings change the float only, and each keeps its own @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await page.getByTestId("prompter-settings-toggle").click();
    await expect(page.getByTestId("prompter-layout-heading")).toHaveText("Floating window");
    await nudgeFontSize(page, 2);
    await expect.poll(async () => (await layout(pip)).fontSize).toBe(24);
    await expect(page.getByTestId("prompter-settings")).toContainText("24px");

    await closeFloat(page, pip);
    await expect(page.getByTestId("prompter-layout-heading")).toHaveCount(0);
    expect((await layout(page)).fontSize).toBe(28);
    await expect(page.getByTestId("prompter-settings")).toContainText("28px");
    await nudgeFontSize(page, -1);
    await expect.poll(async () => (await layout(page)).fontSize).toBe(27);

    const again = await openFloat(page);
    expect((await layout(again)).fontSize).toBe(24);
  });

  test("moving between the two sizes keeps the reading place, both ways @nomedia", async ({ page }) => {
    await withScript(page);
    await page.getByTestId("prompter-viewport").evaluate((el) => (el.scrollTop = 9000));
    await page.waitForTimeout(150);
    const start = await wordAtReadingLine(page);

    const pip = await openFloat(page);
    await page.getByTestId("prompter-settings-toggle").click();
    await nudgeFontSize(page, 6);
    await expect.poll(async () => (await layout(pip)).fontSize).toBe(28);
    await pip.waitForTimeout(150);
    expect(Math.abs((await wordAtReadingLine(pip)) - start)).toBeLessThan(40);

    await closeFloat(page, pip);
    await page.waitForTimeout(150);
    expect(Math.abs((await wordAtReadingLine(page)) - start)).toBeLessThan(40);
    const again = await openFloat(page);
    await again.waitForTimeout(150);
    expect(Math.abs((await wordAtReadingLine(again)) - start)).toBeLessThan(40);
  });

  test("Reset to camera layout puts the defaults back @nomedia", async ({ page }) => {
    await withScript(page);
    const pip = await openFloat(page);
    await page.getByTestId("prompter-settings-toggle").click();
    await nudgeFontSize(page, 5);
    await expect.poll(async () => (await layout(pip)).fontSize).toBe(27);
    await page.getByTestId("prompter-layout-reset").click();
    await expect.poll(async () => (await layout(pip)).fontSize).toBe(22);
    const l = await layout(pip);
    expect(l.align).toBe("center");
    expect(Math.abs(l.line - 0.1)).toBeLessThan(0.02);
  });

  test("the float's layout is saved with the presentation @nomedia", async ({ page }) => {
    const id = await withScript(page);
    const pip = await openFloat(page);
    await page.getByTestId("prompter-settings-toggle").click();
    await nudgeFontSize(page, 3);
    await expect.poll(async () => (await layout(pip)).fontSize).toBe(25);
    await expect.poll(async () => (await readSessionFromIdb(page, id))?.teleprompter, { timeout: 5000 }).toMatchObject({ floatFontSize: 25, fontSize: 28 });

    const closed = pip.waitForEvent("close");
    await page.reload();
    await closed;
    await page.getByTestId("tab-prompter").click();
    const again = await openFloat(page);
    expect((await layout(again)).fontSize).toBe(25);
  });
});

test("the in-page panel uses the camera layout too @nomedia", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "documentPictureInPicture", { value: undefined, configurable: true }));
  await withScript(page);
  await page.getByTestId("prompter-float").click();
  const panel = page.getByTestId("float-prompter");
  await expect(panel).toHaveAttribute("data-kind", "panel");
  const box = (await panel.boundingBox())!;
  expect(box.width).toBe(380);
  expect(box.height).toBe(200);
  const section = await panel.getByTestId("prompter-section").first().evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), align: getComputedStyle(el).textAlign }));
  expect(section).toEqual({ size: 22, align: "center" });
});

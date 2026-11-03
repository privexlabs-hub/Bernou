import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createSessionViaUi } from "./helpers";

const fixture = (name: string) => fileURLToPath(new URL(`../../../../fixtures/decks/${name}`, import.meta.url));
const LECTURE = fixture("lecture-20.pdf");
const NOTES_PAGES = fixture("notes-pages.pdf");
const PREVIEW = '[data-testid="preview-canvas"]';

/** A real click on a real button, going through the browser's file chooser. */
async function chooseVia(page: Page, button: string, files: Parameters<import("@playwright/test").FileChooser["setFiles"]>[0]) {
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByTestId(button).click();
  await (await chooser).setFiles(files);
}

const pixel = (page: Page, selector: string, x: number, y: number) =>
  page.evaluate(
    ({ selector, x, y }) => {
      const c = document.querySelector<HTMLCanvasElement>(selector)!;
      return Array.from(c.getContext("2d")!.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data.slice(0, 3));
    },
    { selector, x, y },
  );

const near = (a: number[], b: number[], tolerance = 8) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

async function sessions(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Array<{ id: string; title: string; slideCount: number }>>((resolve) => {
        const open = indexedDB.open("bernou");
        open.onsuccess = () => {
          const q = open.result.transaction("sessions").objectStore("sessions").getAll();
          q.onsuccess = () => {
            open.result.close();
            resolve(q.result);
          };
        };
      }),
  );
}

/** A solid-colour image, made by the browser so every format is real. */
async function image(page: Page, name: string, color: string, mimeType: string, size = 400) {
  const dataUrl = await page.evaluate(
    ({ color, mimeType, size }) => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = Math.round((size * 9) / 16);
      const g = c.getContext("2d")!;
      g.fillStyle = color;
      g.fillRect(0, 0, c.width, c.height);
      return c.toDataURL(mimeType);
    },
    { color, mimeType, size },
  );
  return { name, mimeType, buffer: Buffer.from(dataUrl.split(",")[1]!, "base64") };
}

async function openAudience(page: Page) {
  const popup = page.context().waitForEvent("page");
  await page.getByTestId("audience-window-open").click();
  const audience = await popup;
  await audience.waitForLoadState();
  await expect.poll(() => audience.evaluate(() => (window as unknown as { __bernouAudience: { seq(): number } }).__bernouAudience.seq())).toBeGreaterThan(0);
  return audience;
}

test.describe("the real buttons @nomedia", () => {
  test("Import presentation on the dashboard opens the picker and imports @nomedia", async ({ page }) => {
    await page.goto("/");
    await chooseVia(page, "import-presentation", LECTURE);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await expect(page.getByTestId("import-done")).toContainText("lecture-20.pdf");
    await expect(page.getByTestId("import-done")).toContainText("20 slides");
  });

  test("Import then Replace slides in the studio open the picker and swap the deck @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await chooseVia(page, "studio-import", LECTURE);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await chooseVia(page, "studio-import", NOTES_PAGES);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 30_000 });
    await expect(page.getByTestId("import-done")).toContainText("notes-pages.pdf");
  });

  test("replacing with the same file still says it worked @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await chooseVia(page, "studio-import", LECTURE);
    await expect(page.getByTestId("import-done")).toContainText("20 slides", { timeout: 30_000 });
    await page.getByTestId("slide-next").click();
    await chooseVia(page, "studio-import", LECTURE);
    await expect(page.getByTestId("import-progress")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("import-done")).toContainText("Replaced with lecture-20.pdf");
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20");
  });
});

test.describe("replacing @nomedia", () => {
  test("the audience window shows the new deck, not the old one @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await createSessionViaUi(page);
    const a = await image(page, "a.png", "#ff0000", "image/png");
    const b = await image(page, "b.png", "#0000ff", "image/png");
    await page.getByTestId("studio-import-input").setInputFiles(a);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 1", { timeout: 30_000 });
    const audience = await openAudience(page);
    await expect.poll(() => pixel(audience, "#audience-canvas", 0.5, 0.5)).toEqual([255, 0, 0]);

    await page.getByTestId("studio-import-input").setInputFiles(b);
    await expect.poll(() => pixel(page, PREVIEW, 0.5, 0.5)).toEqual([0, 0, 255]);
    await expect.poll(() => pixel(audience, "#audience-canvas", 0.5, 0.5), { timeout: 5000 }).toEqual([0, 0, 255]);
  });

  async function deckWithNoteAndLink(page: Page) {
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles(LECTURE);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await page.getByTestId("script-paste").fill("Opening words.");
    await page.getByTestId("script-paste-commit").click();
    await page.getByTestId("section-slide").click();
    await page.getByRole("option", { name: "Slide 1", exact: true }).click();
    await expect(page.getByTestId("script-save-state")).toHaveText("Saved", { timeout: 5000 });
    await page.getByTestId("tab-notes").click();
    await page.getByTestId("notes-body").fill("Remember this.");
    await expect(page.getByTestId("notes-save-state")).toHaveText("Saved", { timeout: 5000 });
  }

  test("with notes or links it asks; Cancel changes nothing @nomedia", async ({ page }) => {
    await deckWithNoteAndLink(page);
    await page.getByTestId("studio-import-input").setInputFiles(NOTES_PAGES);
    await expect(page.getByTestId("replace-prompt")).toBeVisible();
    await page.getByTestId("replace-cancel").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20");
    await expect(page.getByTestId("notes-body")).toHaveValue("Remember this.");
  });

  test("Keep by number keeps notes and links @nomedia", async ({ page }) => {
    await deckWithNoteAndLink(page);
    await page.getByTestId("studio-import-input").setInputFiles(NOTES_PAGES);
    await page.getByTestId("replace-keep").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 30_000 });
    await expect(page.getByTestId("notes-body")).toHaveValue("Remember this.");
    await page.getByTestId("tab-script").click();
    await expect(page.getByTestId("section-slide")).toContainText("Slide 1");
  });

  test("Clear removes notes and links but never the script @nomedia", async ({ page }) => {
    await deckWithNoteAndLink(page);
    await page.getByTestId("studio-import-input").setInputFiles(NOTES_PAGES);
    await page.getByTestId("replace-clear").click();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 30_000 });
    await expect(page.getByTestId("notes-body")).toHaveValue("");
    await page.getByTestId("tab-script").click();
    await expect(page.getByTestId("section-body")).toHaveValue("Opening words.");
    await expect(page.getByTestId("section-slide")).toContainText("No slide");
    await expect(page.getByTestId("script-save-state")).toHaveText("Saved", { timeout: 5000 });
    await page.reload();
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 15_000 });
    await page.getByTestId("tab-notes").click();
    await expect(page.getByTestId("notes-body")).toHaveValue("");
  });

  test("no notes or links, no question @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles(LECTURE);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await page.getByTestId("studio-import-input").setInputFiles(NOTES_PAGES);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 4", { timeout: 30_000 });
    await expect(page.getByTestId("replace-prompt")).toHaveCount(0);
  });

  test("not during a recording @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles(LECTURE);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await page.getByTestId("mic-toggle").click();
    await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "true");
    await page.getByTestId("record-toggle").click();
    await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
    await expect(page.getByTestId("studio-import")).toBeDisabled();
  });
});

test.describe("from the dashboard @nomedia", () => {
  test("PowerPoint explains itself and leaves no empty presentation behind @nomedia", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("import-file-input").setInputFiles({
      name: "deck.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from("PK\u0003\u0004fake"),
    });
    await expect(page.getByTestId("pptx-guidance")).toBeVisible();
    expect(page.url()).not.toContain("/studio/");
    expect(await sessions(page)).toEqual([]);
  });

  test("an unsupported file is refused there too @nomedia", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("import-file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("dashboard-import-error")).toContainText("PDF, PNG, JPEG or WebP");
    expect(await sessions(page)).toEqual([]);
  });

  test("several images become slides in name order @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await page.goto("/");
    await page.getByTestId("import-file-input").setInputFiles([await image(page, "slide10.png", "#0000ff", "image/png"), await image(page, "slide2.png", "#00ff00", "image/png"), await image(page, "slide1.png", "#ff0000", "image/png")]);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 3", { timeout: 30_000 });
    await expect.poll(() => pixel(page, PREVIEW, 0.5, 0.5)).toEqual([255, 0, 0]);
    await page.getByTestId("slide-next").click();
    await expect.poll(() => pixel(page, PREVIEW, 0.5, 0.5)).toEqual([0, 255, 0]);
    await page.getByTestId("slide-next").click();
    await expect.poll(() => pixel(page, PREVIEW, 0.5, 0.5)).toEqual([0, 0, 255]);
  });

  test("dropping a file imports it instead of navigating away @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await page.goto("/");
    const png = await image(page, "dropped.png", "#ff0000", "image/png");
    await page.evaluate(
      ({ b64, name }) => {
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([raw], name, { type: "image/png" }));
        document.querySelector('[data-testid="dashboard-drop"]')!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      },
      { b64: png.buffer.toString("base64"), name: png.name },
    );
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 1", { timeout: 30_000 });
  });
});

test.describe("what goes wrong @nomedia", () => {
  test("a broken PDF says so and the button still works @nomedia", async ({ page }) => {
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") });
    await expect(page.getByTestId("import-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("studio-import")).toBeVisible();
    await chooseVia(page, "studio-import", LECTURE);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 20", { timeout: 30_000 });
    await expect(page.getByTestId("import-error")).toHaveCount(0);
  });

  test("a PDF mixed with images is refused clearly @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles([await image(page, "a.png", "#ff0000", "image/png"), { name: "lecture-20.pdf", mimeType: "application/pdf", buffer: await readFile(LECTURE) }]);
    await expect(page.getByTestId("import-error")).toContainText("one PDF");
  });

  test("a storage failure reports it and leaves the button usable @nomedia", async ({ page, browserName, context }) => {
    test.skip(browserName !== "chromium");
    await context.addInitScript(() => {
      const put = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args: Parameters<typeof put>) {
        if (this.name === "slides" && (window as unknown as { __failSlides?: boolean }).__failSlides) throw new DOMException("disk full", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await createSessionViaUi(page);
    await page.evaluate(() => void ((window as unknown as { __failSlides: boolean }).__failSlides = true));
    await page.getByTestId("studio-import-input").setInputFiles(await image(page, "a.png", "#ff0000", "image/png"));
    await expect(page.getByTestId("import-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("studio-import")).toBeVisible();
  });

  test("leaving during an import finishes it for that presentation and leaves the next one alone @nomedia", async ({ page }) => {
    const first = await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles(LECTURE);
    await page.getByTestId("back-to-dashboard").click();
    await page.getByTestId("new-presentation").click();
    await expect(page).toHaveURL(/\/studio\//);
    const second = page.url().split("/studio/")[1]!;
    expect(second).not.toBe(first);

    await expect.poll(async () => (await sessions(page)).find((s) => s.id === first)?.slideCount, { timeout: 30_000 }).toBe(20);
    await page.waitForTimeout(300);
    await expect(page.getByTestId("slide-counter")).toHaveText("—");
    expect((await sessions(page)).find((s) => s.id === second)?.slideCount).toBe(0);
  });
});

test.describe("slide quality and size", () => {
  test("a small-page PDF is rendered at output resolution, not its point size @nomedia", async ({ page }) => {
    const doc = await PDFDocument.create();
    doc.addPage([720, 405]); // Google Slides' page size
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles({ name: "small.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 1", { timeout: 30_000 });
    const width = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("bernou");
          open.onsuccess = () => {
            const q = open.result.transaction("slides").objectStore("slides").getAll();
            q.onsuccess = () => {
              open.result.close();
              resolve(q.result[0].width);
            };
          };
        }),
    );
    expect(width).toBe(1920);
  });

  test("every slide of a 100-slide deck shows, including after going back @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    test.setTimeout(180_000);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 100; i++) {
      const p = doc.addPage([320, 180]);
      p.drawRectangle({ x: 0, y: 0, width: 320, height: 180, color: rgb(0.1, 0.5, (i % 10) / 10) });
      p.drawText(String(i + 1), { x: 10, y: 10, size: 12, font });
    }
    await createSessionViaUi(page);
    await page.getByTestId("studio-import-input").setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 100", { timeout: 150_000 });
    const shown = async () => {
      const [r, g, b] = await pixel(page, PREVIEW, 0.5, 0.5);
      return r! + g! + b! > 60; // not the near-black background
    };
    await expect.poll(shown).toBe(true);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("End");
    await expect(page.getByTestId("slide-counter")).toHaveText("100 / 100");
    await expect.poll(shown, { timeout: 5000 }).toBe(true);
    await page.keyboard.press("Home");
    await expect.poll(shown, { timeout: 5000 }).toBe(true);
    // Walk the whole deck: the cache holds 64, so this is what makes it drop slides.
    for (let slide = 1; slide < 100; slide += 7) {
      for (let i = 0; i < 7 && slide + i < 100; i++) await page.keyboard.press("ArrowRight");
      await expect.poll(shown, { timeout: 5000 }).toBe(true);
    }
    await page.keyboard.press("Home");
    await expect.poll(shown, { timeout: 5000 }).toBe(true);
  });

  test("a small WebP reaches the audience window @nomedia", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await createSessionViaUi(page);
    const webp = await image(page, "a.webp", "#ff0000", "image/webp");
    await page.getByTestId("studio-import-input").setInputFiles(webp);
    await expect(page.getByTestId("slide-counter")).toHaveText("1 / 1", { timeout: 30_000 });
    const audience = await openAudience(page);
    await expect.poll(async () => near(await pixel(audience, "#audience-canvas", 0.5, 0.5), [255, 0, 0]), { timeout: 5000 }).toBe(true);
  });
});

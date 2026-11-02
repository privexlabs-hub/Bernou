/**
 * Dev helper: screenshot a page of the built app using the system Chrome.
 * usage: node scripts/screenshot.mjs <out.png> [dashboard|studio]
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
const [, , out, what = "dashboard"] = process.argv;
const srv = spawn("pnpm", ["preview"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const fx = fileURLToPath(new URL("../../../fixtures/media", import.meta.url));
const b = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${fx}/cam.y4m`, `--use-file-for-fake-audio-capture=${fx}/tone.wav`] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["camera", "microphone"] });
const p = await ctx.newPage();
await p.goto("http://localhost:4173/");
if (what === "studio") {
  await p.getByTestId("import-file-input").setInputFiles(fileURLToPath(new URL("../../../fixtures/decks/lecture-20.pdf", import.meta.url)));
  await p.waitForURL(/studio/);
  await p.getByTestId("slide-counter").filter({ hasText: "1 / 20" }).waitFor();
  await p.getByRole("button", { name: "Slide 3" }).click();
  await p.getByTestId("camera-toggle").click().catch(() => {});
  await p.getByTestId("mic-toggle").click().catch(() => {});
  if (process.argv[4] === "prompter") {
    await p.getByTestId("tab-script").click();
    const speech = Array.from({ length: 12 }, (_, i) => `Section ${i + 1}. ${"Thermodynamics tells us that energy is conserved, but entropy always increases. ".repeat(3)}`).join("\n\n");
    await p.getByTestId("script-paste").fill(speech);
    await p.getByTestId("script-paste-commit").click();
    await p.getByTestId("section-split").first().click();
    await p.getByTestId("tab-prompter").click();
    await p.getByTestId("prompter-toggle").click();
    await p.waitForTimeout(2500);
  } else {
    await p.waitForTimeout(1200);
  }
} else {
  await p.getByTestId("new-presentation").click();
  await p.waitForURL(/studio/);
  await p.goto("http://localhost:4173/");
  await p.waitForSelector('[data-testid="session-card"]');
}
await p.screenshot({ path: out });
await b.close();
srv.kill();
process.exit(0);

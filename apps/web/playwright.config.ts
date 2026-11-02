import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath, URL } from "node:url";

const fixtures = fileURLToPath(new URL("../../fixtures/media", import.meta.url));

/**
 * E2E configuration.
 *
 * Chromium gets deterministic fake camera/microphone devices so media tests
 * (camera activation, overlay rendering, audience window parity) produce
 * identical frames on every run. Firefox uses its own fake-stream preference.
 * WebKit runs the non-media suites only (tagged @nomedia).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: "rm -rf dist && pnpm build && pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use the system Chrome when Playwright's own build isn't installed
        // (e.g. sandboxed environments). Set PW_CHROME_CHANNEL=chrome to force.
        ...(process.env.PW_CHROME_CHANNEL ? { channel: process.env.PW_CHROME_CHANNEL } : {}),
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-video-capture=${fixtures}/cam.y4m`,
            `--use-file-for-fake-audio-capture=${fixtures}/tone.wav`,
            "--autoplay-policy=no-user-gesture-required",
          ],
        },
        permissions: ["camera", "microphone"],
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
            "dom.disable_open_during_load": false,
          },
        },
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      grep: /@nomedia/,
    },
  ],
});

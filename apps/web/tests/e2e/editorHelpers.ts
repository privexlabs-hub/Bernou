import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { expect, type Download, type Page } from "@playwright/test";
import { createSessionViaUi } from "./helpers";

const speechWav = fileURLToPath(new URL("../../../../fixtures/media/speech.wav", import.meta.url));

export interface FakeSource {
  /** Original-clock seconds at which the picture flashes white and the sound clicks. */
  flashes?: number[];
  /** A stretch with no new video frames, like the gaps in real recordings. */
  hold?: [number, number];
  /** Speech with steady noise under it, instead of the tone. */
  speech?: boolean;
}

/**
 * Replaces the camera and microphone with page-made sources whose content is
 * known: the picture's colour encodes the time to the hundredth of a second
 * (R seconds, G tenths, B hundredths), and the sound is a 1 kHz tone (or speech
 * and noise). Both run off one AudioContext clock, so flashes and clicks are
 * truly simultaneous.
 */
export async function installFakeSource(page: Page, src: FakeSource = {}) {
  await page.route("**/__fixture/speech.wav", async (route) => route.fulfill({ body: await readFile(speechWav), contentType: "audio/wav" }));
  await page.addInitScript((s: FakeSource) => {
    const w = window as unknown as { __fake?: { ctx: AudioContext; t0: number } };
    const clock = () => {
      if (!w.__fake) {
        const ctx = new AudioContext({ sampleRate: 48000 });
        void ctx.resume();
        w.__fake = { ctx, t0: ctx.currentTime };
      }
      return w.__fake;
    };
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const { ctx, t0 } = clock();
      if (c?.video) {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const g = canvas.getContext("2d")!;
        const draw = () => {
          const t = ctx.currentTime - t0;
          if (s.hold && t >= s.hold[0] && t < s.hold[1]) return; // no new frames
          const flash = (s.flashes ?? []).some((f) => t >= f && t < f + 0.07);
          if (flash) g.fillStyle = "rgb(255,255,255)";
          else {
            const sec = Math.floor(t);
            const tenth = Math.floor((t * 10) % 10);
            const hund = Math.floor((t * 100) % 10);
            g.fillStyle = `rgb(${Math.min(250, 30 + sec * 20)},${tenth * 25},${hund * 25})`;
          }
          g.fillRect(0, 0, 640, 360);
        };
        draw();
        setInterval(draw, 8);
        const stream = canvas.captureStream(30);
        return stream;
      }
      if (c?.audio) {
        const out = ctx.createMediaStreamDestination();
        if (s.speech) {
          const phrase = await ctx.decodeAudioData(await (await fetch("/__fixture/speech.wav")).arrayBuffer());
          // The phrase then 1.5 s of silence, looped: noise alone between phrases. (A loopEnd past the
          // buffer's end is clamped to it, so the silence has to be in the buffer.)
          const buf = ctx.createBuffer(1, phrase.length + Math.round(1.5 * ctx.sampleRate), ctx.sampleRate);
          buf.copyToChannel(phrase.getChannelData(0), 0);
          const voice = ctx.createBufferSource();
          voice.buffer = buf;
          voice.loop = true;
          voice.connect(out);
          voice.start(t0 + 1);
          const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
          const d = n.getChannelData(0);
          let seed = 3;
          for (let i = 0; i < d.length; i++) d[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.12;
          const noise = ctx.createBufferSource();
          noise.buffer = n;
          noise.loop = true;
          noise.connect(out);
          noise.start(t0);
        } else {
          const osc = ctx.createOscillator();
          osc.frequency.value = 1000;
          const lvl = ctx.createGain();
          lvl.gain.value = 0.2;
          osc.connect(lvl).connect(out);
          osc.start(t0);
          for (const f of s.flashes ?? []) {
            // A 10 ms click, loud enough to find above the tone.
            const click = ctx.createBuffer(1, 480, ctx.sampleRate);
            click.getChannelData(0).fill(0.85);
            const b = ctx.createBufferSource();
            b.buffer = click;
            b.connect(out);
            b.start(t0 + f);
          }
        }
        return out.stream;
      }
      return real(c);
    };
  }, src);
}

/** A recording of about `seconds`, made in the studio with the fake source, then opened in the editor. */
export async function recordAndOpenEditor(page: Page, seconds: number): Promise<void> {
  await createSessionViaUi(page);
  await page.getByTestId("tab-camera").click();
  await page.getByTestId("layout-camera-full").click();
  await page.getByTestId("camera-toggle").click();
  await expect(page.getByTestId("camera-toggle")).toHaveAttribute("data-live", "true");
  await page.getByTestId("mic-toggle").click();
  await expect(page.getByTestId("mic-toggle")).toHaveAttribute("data-live", "true");
  await page.waitForTimeout(500);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("record-toggle")).toHaveAttribute("data-status", "recording");
  await page.waitForTimeout(seconds * 1000);
  await page.getByTestId("record-toggle").click();
  await expect(page.getByTestId("recording-finished")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("recording-edit").click();
  await expect(page.getByTestId("editor")).toBeVisible({ timeout: 30_000 });
}

/** Selects an original-time range in the editor, with the selection fields. */
export async function select(page: Page, start: number, end: number) {
  await page.getByTestId("editor-sel-end").fill(String(end));
  await page.getByTestId("editor-sel-start").fill(String(start));
  await page.getByTestId("editor-sel-end").fill(String(end));
}

/** Exports and returns the downloaded file. */
export async function exportVideo(page: Page): Promise<Download> {
  const dl = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByTestId("editor-export").click();
  await expect(page.getByTestId("editor-export-done")).toBeVisible({ timeout: 120_000 });
  return dl;
}

/** The time a frame's colour encodes, or null for a flash or something unreadable. */
export function decodeColour([r, g, b]: number[]): number | null {
  if (r! > 245 && g! > 240 && b! > 240) return null;
  const sec = Math.round((r! - 30) / 20);
  const tenth = Math.round(g! / 25);
  const hund = Math.round(b! / 25);
  if (sec < 0 || tenth > 9 || hund > 9) return null;
  return sec + tenth / 10 + hund / 100;
}

/** Every recording file in OPFS, with its size and a hash, for checking that nothing changed. */
export async function originalBytes(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("recordings", { create: true });
    const out: string[] = [];
    for await (const [name, h] of (root as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
      if (h.kind !== "file") continue;
      const f = await h.getFile();
      const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
      out.push(`${name}:${f.size}:${Array.from(new Uint8Array(digest).slice(0, 8)).join(".")}`);
    }
    return out.sort().join("|");
  });
}

/** The newest original recording's bytes, read from the app's storage. */
export async function readOriginal(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("recordings");
    let newest: File | null = null;
    for await (const [, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemFileHandle]> }).entries()) {
      if (h.kind !== "file") continue;
      const f = await h.getFile();
      if (!newest || f.lastModified > newest.lastModified) newest = f;
    }
    const bytes = new Uint8Array(await newest!.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return Buffer.from(b64, "base64");
}

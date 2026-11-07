import { readFile } from "node:fs/promises";
import type { Download, Page } from "@playwright/test";

/**
 * Inspects a real downloaded recording by decoding it in the browser (no
 * ffprobe here). Installs window.__probe in `page`, holding the file's bytes.
 */
export async function loadRecording(page: Page, download: Download): Promise<Buffer> {
  return loadRecordingBytes(page, await readFile(await download.path()), download.suggestedFilename());
}

/** As `loadRecording`, for bytes already in hand (an original read from storage). */
export async function loadRecordingBytes(page: Page, bytes: Buffer, fileName: string): Promise<Buffer> {
  await page.evaluate(
    async ({ b64, name }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const type = name.endsWith(".mp4") ? "video/mp4" : "video/webm";
      const blob = new Blob([raw], { type });
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error("the recording won't load: " + video.error?.message));
        video.src = URL.createObjectURL(blob);
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const seek = (t: number) =>
        new Promise<number>((res) => {
          const start = performance.now();
          const timer = setTimeout(() => res(-1), 5000);
          video.onseeked = () => {
            clearTimeout(timer);
            res(performance.now() - start);
          };
          video.currentTime = t;
        });
      const px = (x: number, y: number) => {
        ctx.drawImage(video, 0, 0);
        return Array.from(ctx.getImageData(Math.round(x * canvas.width), Math.round(y * canvas.height), 1, 1).data.slice(0, 3));
      };
      let audio: AudioBuffer | null = null;
      try {
        audio = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(await blob.arrayBuffer());
      } catch {
        /* reported as no audio */
      }
      (window as unknown as { __probe: unknown }).__probe = { video, seek, px, audio, canvas, ctx };
    },
    { b64: bytes.toString("base64"), name: fileName },
  );
  return bytes;
}

interface Probe {
  video: HTMLVideoElement;
  seek(t: number): Promise<number>;
  px(x: number, y: number): number[];
  audio: AudioBuffer | null;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
}
const probe = () => (window as unknown as { __probe: Probe }).__probe;

export const fileInfo = (page: Page) =>
  page.evaluate(`(() => { const p = window.__probe; return { width: p.video.videoWidth, height: p.video.videoHeight, duration: p.video.duration, audioSeconds: p.audio ? p.audio.duration : 0, seekable: p.video.seekable.length ? p.video.seekable.end(0) : 0 }; })()`) as Promise<{ width: number; height: number; duration: number; audioSeconds: number; seekable: number }>;

export const seekTimes = (page: Page, times: number[]) =>
  page.evaluate(async (times) => {
    const out: number[] = [];
    for (const t of times) out.push(await (window as unknown as { __probe: Probe }).__probe.seek(t));
    return out;
  }, times);

export const pixelAt = (page: Page, t: number, x: number, y: number) =>
  page.evaluate(
    async ({ t, x, y }) => {
      const p = (window as unknown as { __probe: Probe }).__probe;
      await p.seek(t);
      return p.px(x, y);
    },
    { t, x, y },
  );

/** Sums a region of the frame at time t, to tell whether it changes through the file. */
export const regionChecksum = (page: Page, t: number, [x, y, w, h]: [number, number, number, number]) =>
  page.evaluate(
    async ({ t, x, y, w, h }) => {
      const p = (window as unknown as { __probe: Probe }).__probe;
      await p.seek(t);
      p.px(0, 0); // draws the current frame
      const { width, height } = p.canvas;
      const data = p.ctx.getImageData(Math.round(x * width), Math.round(y * height), Math.round(w * width), Math.round(h * height)).data;
      return data.reduce((sum, v) => sum + v, 0);
    },
    { t, x, y, w, h },
  );

/** Counts the video frames stored in a recording, which unlike playback doesn't depend on how busy the machine is. */
export function countVideoFrames(file: Buffer): number {
  return file.subarray(4, 8).toString("latin1") === "ftyp" ? countMp4Frames(file) : countWebmFrames(file);
}

function countMp4Frames(file: Buffer): number {
  const boxes = (from: number, to: number, visit: (type: string, body: number, end: number) => void) => {
    for (let at = from; at + 8 <= to; ) {
      const size = file.readUInt32BE(at);
      if (size < 8) return;
      visit(file.subarray(at + 4, at + 8).toString("latin1"), at + 8, Math.min(at + size, to));
      at += size;
    }
  };
  let videoTrack = -1;
  let frames = 0;
  // A plain (not fragmented) MP4, like the editor writes, lists its samples in stsz.
  let tableFrames = 0;
  boxes(0, file.length, (type, body, end) => {
    if (type === "moov") {
      boxes(body, end, (t, b, e) => {
        if (t !== "trak") return;
        let id = -1;
        let isVideo = false;
        let count = 0;
        boxes(b, e, (t2, b2, e2) => {
          if (t2 === "tkhd") id = file.readUInt32BE(b2 + (file[b2] === 1 ? 20 : 12));
          if (t2 === "mdia")
            boxes(b2, e2, (t3, b3, e3) => {
              if (t3 === "hdlr") isVideo = file.subarray(b3 + 8, b3 + 12).toString("latin1") === "vide";
              if (t3 === "minf") boxes(b3, e3, (t4, b4, e4) => void (t4 === "stbl" && boxes(b4, e4, (t5, b5) => void (t5 === "stsz" && (count = file.readUInt32BE(b5 + 8))))));
            });
        });
        if (isVideo) {
          videoTrack = id;
          tableFrames = count;
        }
      });
    }
    if (type === "moof") {
      boxes(body, end, (t, b, e) => {
        if (t !== "traf") return;
        let track = -1;
        boxes(b, e, (t2, b2) => {
          if (t2 === "tfhd") track = file.readUInt32BE(b2 + 4);
          if (t2 === "trun" && track === videoTrack) frames += file.readUInt32BE(b2 + 4);
        });
      });
    }
  });
  return frames || tableFrames;
}

function countWebmFrames(file: Buffer): number {
  const MASTERS = new Set([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675, 0xa0]); // Segment, Tracks, TrackEntry, Cluster, BlockGroup
  const vint = (at: number, keepMarker: boolean) => {
    const length = Math.clz32(file[at]!) - 23;
    let value = keepMarker ? file[at]! : file[at]! & (0xff >> length);
    for (let i = 1; i < length; i++) value = value * 256 + file[at + i]!;
    return { value, length };
  };
  let videoTrack = -1;
  let entryTrack = -1;
  let frames = 0;
  for (let at = 0; at < file.length && file[at]; ) {
    const id = vint(at, true);
    const size = vint(at + id.length, false);
    const body = at + id.length + size.length;
    if (id.value === 0xd7) entryTrack = file[body]!; // TrackNumber
    if (id.value === 0x83 && file[body] === 1) videoTrack = entryTrack; // TrackType: video
    if ((id.value === 0xa3 || id.value === 0xa1) && vint(body, false).value === videoTrack) frames++; // (Simple)Block
    at = MASTERS.has(id.value) ? body : body + size.value;
  }
  return frames;
}

/** Loudness and how much of it is the 440 Hz test tone, over [from, to] seconds. */
export const audioStats = (page: Page, from: number, to: number) =>
  page.evaluate(
    ({ from, to }) => {
      const a = (window as unknown as { __probe: Probe }).__probe.audio;
      if (!a) return { rms: 0, tone: 0 };
      const d = a.getChannelData(0);
      const s = d.subarray(Math.floor(from * a.sampleRate), Math.floor(to * a.sampleRate));
      let energy = 0;
      for (const v of s) energy += v * v;
      const rms = Math.sqrt(energy / (s.length || 1));
      const w = (2 * Math.PI * 440) / a.sampleRate;
      let re = 0;
      let im = 0;
      s.forEach((v, i) => {
        re += v * Math.cos(w * i);
        im += v * Math.sin(w * i);
      });
      return { rms, tone: (2 * Math.hypot(re, im)) / (s.length || 1) };
    },
    { from, to },
  );

/** The first time in [from, to] the audio's RMS over 20ms windows stays below `level`. */
export const silenceStart = (page: Page, from: number, to: number, level: number) =>
  page.evaluate(
    ({ from, to, level }) => {
      const a = (window as unknown as { __probe: Probe }).__probe.audio!;
      const d = a.getChannelData(0);
      const win = Math.floor(0.02 * a.sampleRate);
      for (let i = Math.floor(from * a.sampleRate); i < Math.min(d.length, to * a.sampleRate) - win * 5; i += win) {
        let quiet = true;
        for (let j = 0; j < 5 && quiet; j++) {
          let e = 0;
          for (let k = 0; k < win; k++) e += d[i + j * win + k]! ** 2;
          quiet = Math.sqrt(e / win) < level;
        }
        if (quiet) return i / a.sampleRate;
      }
      return null;
    },
    { from, to, level },
  );

/** Level of each frequency between two times, in dB relative to full scale. Hann-windowed, complex magnitude. */
export const toneLevels = (page: Page, from: number, to: number, freqs: number[]) =>
  page.evaluate(
    ({ from, to, freqs }) => {
      const a = (window as unknown as { __probe: Probe }).__probe.audio;
      if (!a) return freqs.map(() => -Infinity);
      const s = a.getChannelData(0).subarray(Math.floor(from * a.sampleRate), Math.floor(to * a.sampleRate));
      const n = s.length;
      return freqs.map((f) => {
        const w = (2 * Math.PI * f) / a.sampleRate;
        let re = 0;
        let im = 0;
        let windowSum = 0;
        for (let i = 0; i < n; i++) {
          const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
          windowSum += hann;
          re += s[i]! * hann * Math.cos(w * i);
          im += s[i]! * hann * Math.sin(w * i);
        }
        return 20 * Math.log10((2 * Math.hypot(re, im)) / windowSum);
      });
    },
    { from, to, freqs },
  );

/**
 * Fragments whose start (tfdt) isn't where the previous fragment's samples, added
 * up, end. Players that add up durations (QuickTime) drift by these amounts.
 */
export function fragmentTimingErrors(file: Buffer): number {
  if (file.subarray(4, 8).toString("latin1") !== "ftyp") return 0;
  const boxes = (from: number, to: number, visit: (type: string, body: number, end: number) => void) => {
    for (let at = from; at + 8 <= to; ) {
      const size = file.readUInt32BE(at);
      if (size < 8) return;
      visit(file.subarray(at + 4, at + 8).toString("latin1"), at + 8, Math.min(at + size, to));
      at += size;
    }
  };
  const end = new Map<number, number>();
  let errors = 0;
  boxes(0, file.length, (type, body, stop) => {
    if (type !== "moof") return;
    boxes(body, stop, (t, b, e) => {
      if (t !== "traf") return;
      let track = -1;
      let time = 0;
      boxes(b, e, (t2, b2) => {
        if (t2 === "tfhd") track = file.readUInt32BE(b2 + 4);
        if (t2 === "tfdt") {
          time = file[b2] === 1 ? Number(file.readBigUInt64BE(b2 + 4)) : file.readUInt32BE(b2 + 4);
          if (end.has(track) && end.get(track) !== time) errors++;
        }
        if (t2 === "trun") {
          const flags = file.readUInt32BE(b2) & 0xffffff;
          const n = file.readUInt32BE(b2 + 4);
          let o = b2 + 8 + (flags & 1 ? 4 : 0) + (flags & 4 ? 4 : 0);
          for (let i = 0; i < n; i++) {
            time += file.readUInt32BE(o);
            o += 4 + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
          }
          end.set(track, time);
        }
      });
    });
  });
  return errors;
}

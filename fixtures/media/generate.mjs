#!/usr/bin/env node
/**
 * Generates deterministic fake-media fixtures for Playwright:
 *   cam.y4m  — 320x240, 30 frames, 4:2:0, a magenta/green diagonal pattern with
 *              a moving white square (so "is the camera live" checks can detect motion)
 *   tone.wav — 2 s, 48 kHz mono 16-bit, 440 Hz sine at -12 dBFS
 *   speech.wav — not generated here: macOS `say "Good morning everyone. Thank you for having me today."`,
 *                then `afconvert -f WAVE -d LEI16@48000 -c 1`. The editor's noise-removal test mixes noise into it.
 *
 * Both are tiny and committed; this script documents how they were made.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(new URL(".", import.meta.url).pathname);

// ---------- Y4M ----------
const W = 320,
  H = 240,
  FRAMES = 30;
const header = `YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`;
const chunks = [Buffer.from(header, "ascii")];
for (let f = 0; f < FRAMES; f++) {
  const Y = Buffer.alloc(W * H);
  const U = Buffer.alloc((W / 2) * (H / 2));
  const V = Buffer.alloc((W / 2) * (H / 2));
  const sq = 40,
    sx = 20 + Math.round((f / FRAMES) * (W - sq - 40)),
    sy = 100;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const diag = ((x + y) >> 5) & 1;
      const inSq = x >= sx && x < sx + sq && y >= sy && y < sy + sq;
      // magenta (Y≈105,U≈212,V≈235) / green (Y≈150,U≈54,V≈34) / white square
      let yy = diag ? 105 : 150;
      if (inSq) yy = 235;
      Y[y * W + x] = yy;
      if ((x & 1) === 0 && (y & 1) === 0) {
        const i = (y >> 1) * (W >> 1) + (x >> 1);
        U[i] = inSq ? 128 : diag ? 212 : 54;
        V[i] = inSq ? 128 : diag ? 235 : 34;
      }
    }
  }
  chunks.push(Buffer.from("FRAME\n", "ascii"), Y, U, V);
}
writeFileSync(resolve(dir, "cam.y4m"), Buffer.concat(chunks));

// ---------- WAV ----------
const SR = 48000,
  SEC = 2,
  N = SR * SEC;
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const s = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.25;
  pcm.writeInt16LE(Math.round(s * 32767), i * 2);
}
const wav = Buffer.alloc(44);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(pcm.length, 40);
writeFileSync(resolve(dir, "tone.wav"), Buffer.concat([wav, pcm]));

console.log("wrote cam.y4m and tone.wav");

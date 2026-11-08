import { describe, expect, it } from "vitest";
import { fixMp4FragmentGaps } from "../src/recorderMp4";

// Minimal fragmented-MP4 builder: just the boxes the fix reads.
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
const box = (type: string, ...parts: number[][]) => {
  const body = parts.flat();
  return [...u32(8 + body.length), ...[...type].map((c) => c.charCodeAt(0)), ...body];
};
const full = (version: number, flags: number) => [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255];
/** A track's fragment: start time, and its samples' durations. */
const traf = (track: number, start: number, durations: number[]) =>
  box("traf", box("tfhd", full(0, 0), u32(track)), box("tfdt", full(1, 0), u64(start)), box("trun", full(0, 0x300), u32(durations.length), ...durations.map((d) => [...u32(d), ...u32(10)])));
const fragment = (...trafs: number[][]) => [...box("moof", box("mfhd", full(0, 0), u32(1)), ...trafs), ...box("mdat", Array.from({ length: 20 }, (_, i) => i))];
const file = (...fragments: number[][]) => new Blob([new Uint8Array([...box("ftyp", [..."isom"].map((c) => c.charCodeAt(0)), u32(0)), ...box("moov", box("mvhd", full(0, 0))), ...fragments.flat()])]);

/** Every sample's duration in the file, per track, in order, as a player that ignores tfdt would add them up. */
async function durations(blob: Blob): Promise<Record<number, number[]>> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const d = new DataView(b.buffer);
  const out: Record<number, number[]> = {};
  const walk = (from: number, to: number, track = 0) => {
    for (let o = from; o + 8 <= to; ) {
      const size = d.getUint32(o);
      const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
      if (type === "moof" || type === "traf") walk(o + 8, o + size, track);
      if (type === "tfhd") track = d.getUint32(o + 12);
      if (type === "trun") {
        const n = d.getUint32(o + 12);
        for (let i = 0; i < n; i++) (out[track] ??= []).push(d.getUint32(o + 16 + i * 8));
      }
      o += size;
    }
  };
  walk(0, b.length);
  return out;
}

describe("fixMp4FragmentGaps", () => {
  it("stretches each fragment's last sample to reach the next fragment, so summed durations match the real timeline", async () => {
    // Track 2's second fragment starts at 1000, but the first one's samples only add up to 900.
    const input = file(fragment(traf(2, 0, [300, 300, 300])), fragment(traf(2, 1000, [300, 300])));
    const fixed = await fixMp4FragmentGaps(input);
    expect(fixed?.patched).toBe(1);
    expect((await durations(fixed!.blob))[2]).toEqual([300, 300, 400, 300, 300]);
  });

  it("treats tracks separately", async () => {
    const input = file(fragment(traf(1, 0, [100, 100]), traf(2, 0, [300])), fragment(traf(1, 205, [100]), traf(2, 300, [300])));
    const fixed = await fixMp4FragmentGaps(input);
    const d = await durations(fixed!.blob);
    expect(d[1]).toEqual([100, 105, 100]);
    expect(d[2]).toEqual([300, 300]); // already continuous
    expect(fixed?.patched).toBe(1);
  });

  it("leaves a continuous file byte for byte the same", async () => {
    const input = file(fragment(traf(2, 0, [300, 300])), fragment(traf(2, 600, [300])));
    const fixed = await fixMp4FragmentGaps(input);
    expect(fixed?.patched).toBe(0);
    expect(new Uint8Array(await fixed!.blob.arrayBuffer())).toEqual(new Uint8Array(await input.arrayBuffer()));
  });

  it("an overlap shortens the last sample to meet the next fragment, as Chrome itself places it", async () => {
    // Found in a real recording: 34 fragments started before the previous one's samples ended.
    const input = file(fragment(traf(2, 0, [300, 300])), fragment(traf(2, 500, [300])));
    const fixed = await fixMp4FragmentGaps(input);
    expect(fixed?.patched).toBe(1);
    expect((await durations(fixed!.blob))[2]).toEqual([300, 200, 300]);
  });

  it("leaves a sample alone rather than give it no length at all", async () => {
    const input = file(fragment(traf(2, 0, [300, 300])), fragment(traf(2, 300, [300])));
    const fixed = await fixMp4FragmentGaps(input);
    expect(fixed?.patched).toBe(0);
    expect((await durations(fixed!.blob))[2]).toEqual([300, 300, 300]);
  });

  it("changes only duration bytes: the media data and the file's size are untouched", async () => {
    const input = file(fragment(traf(2, 0, [300])), fragment(traf(2, 1000, [300])));
    const a = new Uint8Array(await input.arrayBuffer());
    const b = new Uint8Array(await (await fixMp4FragmentGaps(input))!.blob.arrayBuffer());
    expect(b.length).toBe(a.length);
    const changed = a.reduce<number[]>((list, v, i) => (v !== b[i] ? [...list, i] : list), []);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(4);
  });

  it("isn't for files that aren't MP4", async () => {
    expect(await fixMp4FragmentGaps(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])]))).toBeNull();
  });

  it("copes with a file cut short mid-box, as after a crash", async () => {
    const whole = new Uint8Array(await file(fragment(traf(2, 0, [300])), fragment(traf(2, 1000, [300]))).arrayBuffer());
    const cut = new Blob([whole.subarray(0, whole.length - 7)]);
    const fixed = await fixMp4FragmentGaps(cut);
    expect(fixed?.patched).toBe(1);
    expect(fixed!.blob.size).toBe(cut.size);
  });
});

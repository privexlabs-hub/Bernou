import { describe, expect, it } from "vitest";
import { patchWebmDuration, pickRecordingFormat, videoBitrate } from "../src/recorder";

describe("pickRecordingFormat", () => {
  it("prefers MP4 with AAC", () => {
    expect(pickRecordingFormat(() => true)?.mimeType).toContain("mp4a.40.2");
  });
  it("falls back to MP4 with Opus, then WebM, and labels the file by its container", () => {
    const f = pickRecordingFormat((m) => !m.includes("mp4a"));
    expect(f).toMatchObject({ extension: "mp4", fileType: "video/mp4" });
    expect(f?.mimeType).toContain("opus");
    expect(pickRecordingFormat((m) => m.startsWith("video/webm"))).toMatchObject({ extension: "webm", fileType: "video/webm" });
  });
  it("returns null when nothing can record", () => {
    expect(pickRecordingFormat(() => false)).toBeNull();
  });
});

describe("videoBitrate", () => {
  it("follows the output height", () => {
    expect([videoBitrate(1080), videoBitrate(720), videoBitrate(480)]).toEqual([6_000_000, 4_000_000, 2_000_000]);
  });
});

/** EBML element with a one-byte size. */
const el = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body];
const EBML = el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01]);
const SEGMENT_UNKNOWN = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const SCALE = el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]); // 1,000,000
const INFO = (extra: number[] = []) => el([0x15, 0x49, 0xa9, 0x66], [...SCALE, ...extra]);
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2, 3];

function durationOf(bytes: Uint8Array): number | null {
  for (let i = 0; i + 11 <= bytes.length; i++) if (bytes[i] === 0x44 && bytes[i + 1] === 0x89 && bytes[i + 2] === 0x88) return new DataView(bytes.buffer, bytes.byteOffset).getFloat64(i + 3);
  return null;
}

describe("patchWebmDuration", () => {
  it("adds a duration to Info and leaves everything after it alone", () => {
    const file = new Uint8Array([...EBML, ...SEGMENT_UNKNOWN, ...INFO(), ...CLUSTER]);
    const r = patchWebmDuration(file, 12_345)!;
    expect(durationOf(r.bytes)).toBe(12_345);
    expect(r.consumed).toBe(EBML.length + SEGMENT_UNKNOWN.length + INFO().length);
    expect([...file.subarray(r.consumed)]).toEqual(CLUSTER);
    // Info's new size covers exactly its old body plus the 11-byte duration.
    const infoAt = EBML.length + SEGMENT_UNKNOWN.length;
    const size = new DataView(r.bytes.buffer, r.bytes.byteOffset).getUint32(infoAt + 4 + 4);
    expect(size).toBe(SCALE.length + 11);
    expect(r.bytes.length).toBe(infoAt + 4 + 8 + size);
  });

  it("converts by the file's timecode scale", () => {
    const scale2ms = el([0x2a, 0xd7, 0xb1], [0x1e, 0x84, 0x80]); // 2,000,000
    const file = new Uint8Array([...EBML, ...SEGMENT_UNKNOWN, ...el([0x15, 0x49, 0xa9, 0x66], scale2ms), ...CLUSTER]);
    expect(durationOf(patchWebmDuration(file, 1000)!.bytes)).toBe(500);
  });

  it("grows a known segment size by what it added", () => {
    const body = [...INFO(), ...CLUSTER];
    const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0, 0, 0, 0, 0, 0, body.length];
    const r = patchWebmDuration(new Uint8Array([...EBML, ...segment, ...body]), 1)!;
    const at = EBML.length + 4;
    const oldInfoSizeWidth = 1;
    expect(new DataView(r.bytes.buffer, r.bytes.byteOffset).getUint32(at + 4)).toBe(body.length + 11 + 8 - oldInfoSizeWidth);
  });

  it("leaves a file alone if it has a duration or isn't a shape it knows", () => {
    expect(patchWebmDuration(new Uint8Array([...EBML, ...SEGMENT_UNKNOWN, ...INFO([0x44, 0x89, 0x84, 0, 0, 0, 0]), ...CLUSTER]), 1)).toBeNull();
    expect(patchWebmDuration(new Uint8Array([1, 2, 3, 4]), 1)).toBeNull();
    expect(patchWebmDuration(new Uint8Array([...EBML, ...SEGMENT_UNKNOWN]), 1)).toBeNull();
  });
});

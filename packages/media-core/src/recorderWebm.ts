/**
 * MediaRecorder writes WebM without a duration, which leaves players unable to
 * show a timeline. This adds one to the Info element by rewriting only the start
 * of the file, so a recording of any size never has to be loaded into memory.
 */
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;

function readId(b: Uint8Array, at: number) {
  const first = b[at];
  if (!first) return null;
  const length = Math.clz32(first) - 23;
  if (length > 4 || at + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + b[at + i]!;
  return { value, length };
}

function readSize(b: Uint8Array, at: number) {
  const first = b[at];
  if (!first) return null;
  const length = Math.clz32(first) - 23;
  if (length > 8 || at + length > b.length) return null;
  let value = first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + b[at + i]!;
    unknown &&= b[at + i] === 0xff;
  }
  return { value, length, unknown };
}

/** Always eight bytes wide: simplest, and valid wherever a size can appear. */
function encodeSize(value: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  new DataView(out.buffer).setUint32(4, value >>> 0);
  out[3] = Math.floor(value / 2 ** 32) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * @param head the first bytes of the file; enough to reach the end of Info
 * @returns replacement bytes for the first `consumed` bytes of the file, or
 *          null to leave it as it is (not a shape we recognise, or already has one)
 */
export function patchWebmDuration(head: Uint8Array, durationMs: number): { bytes: Uint8Array; consumed: number } | null {
  const ebmlId = readId(head, 0);
  const ebmlSize = ebmlId && readSize(head, ebmlId.length);
  if (!ebmlId || !ebmlSize || ebmlSize.unknown) return null;

  const segmentAt = ebmlId.length + ebmlSize.length + ebmlSize.value;
  const segmentId = readId(head, segmentAt);
  if (segmentId?.value !== SEGMENT) return null;
  const segmentSizeAt = segmentAt + segmentId.length;
  const segmentSize = readSize(head, segmentSizeAt);
  if (!segmentSize) return null;

  let at = segmentSizeAt + segmentSize.length;
  while (at < head.length) {
    const id = readId(head, at);
    const size = id && readSize(head, at + id.length);
    if (!id || !size || size.unknown) return null;
    const bodyAt = at + id.length + size.length;
    if (id.value !== INFO) {
      at = bodyAt + size.value;
      continue;
    }
    const bodyEnd = bodyAt + size.value;
    if (bodyEnd > head.length) return null;

    let scale = 1_000_000;
    for (let p = bodyAt; p < bodyEnd; ) {
      const childId = readId(head, p);
      const childSize = childId && readSize(head, p + childId.length);
      if (!childId || !childSize) return null;
      const childBody = p + childId.length + childSize.length;
      if (childId.value === DURATION) return null;
      if (childId.value === TIMECODE_SCALE) {
        scale = 0;
        for (let i = 0; i < childSize.value; i++) scale = scale * 256 + head[childBody + i]!;
      }
      p = childBody + childSize.value;
    }

    const duration = new Uint8Array(11);
    duration.set([0x44, 0x89, 0x88]);
    new DataView(duration.buffer).setFloat64(3, (durationMs * 1_000_000) / scale);

    const newInfoSize = encodeSize(size.value + duration.length);
    const growth = newInfoSize.length - size.length + duration.length;
    return {
      bytes: concat([
        head.subarray(0, segmentSizeAt),
        segmentSize.unknown ? head.subarray(segmentSizeAt, segmentSizeAt + segmentSize.length) : encodeSize(segmentSize.value + growth),
        head.subarray(segmentSizeAt + segmentSize.length, at + id.length),
        newInfoSize,
        head.subarray(bodyAt, bodyEnd),
        duration,
      ]),
      consumed: bodyEnd,
    };
  }
  return null;
}

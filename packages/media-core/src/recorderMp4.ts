/**
 * Makes Chrome's fragmented MP4 recordings play in sync outside Chrome.
 *
 * Chrome's MediaRecorder writes the file in fragments, and each fragment's last
 * sample is listed shorter than the time until the next fragment starts. Chrome
 * places every fragment by its start time (`tfdt`), so it plays fine. Apple's
 * players (QuickTime, Photos, AVFoundation) add up sample durations instead, and
 * lose the gaps: measured on a 10-minute recording, its video came out 16 s
 * shorter than its audio, drifting further out of sync the longer it played.
 *
 * The fix sets each fragment's last sample to end where the next fragment
 * starts: usually lengthened, occasionally shortened where they overlap.
 * Only those 4-byte duration fields change: no media data, no sizes, no
 * re-encoding. Only box headers and the small `moof` boxes are read, so a long
 * recording is never loaded whole.
 */

interface DurationField {
  moof: Uint8Array;
  /** Offset of the 4-byte duration within `moof`. */
  at: number;
}

const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o + 4]!, b[o + 5]!, b[o + 6]!, b[o + 7]!);

function* children(b: Uint8Array, from: number, to: number): Generator<{ type: string; body: number; end: number }> {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let o = from; o + 8 <= to; ) {
    const size = d.getUint32(o);
    if (size < 8 || o + size > to) return;
    yield { type: type(b, o), body: o + 8, end: o + size };
    o += size;
  }
}

/**
 * Walks one `moof`, adjusting the previous fragment's last sample of each track
 * to meet this fragment's start. Returns how many durations it changed.
 */
function patchMoof(moof: Uint8Array, last: Map<number, { field: DurationField; end: number }>): number {
  const d = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  let patched = 0;
  for (const traf of children(moof, 8, moof.length)) {
    if (traf.type !== "traf") continue;
    let track = -1;
    let time: number | null = null;
    let usable = true;
    for (const c of children(moof, traf.body, traf.end)) {
      if (c.type === "tfhd") track = d.getUint32(c.body + 4);
      if (c.type === "tfdt") time = moof[c.body] === 1 ? Number(d.getBigUint64(c.body + 4)) : d.getUint32(c.body + 4);
      if (c.type !== "trun" || track < 0 || time === null) continue;
      const flags = d.getUint32(c.body) & 0xffffff;
      const count = d.getUint32(c.body + 4);
      // Without durations per sample there's no field to lengthen: leave this track alone.
      if (!(flags & 0x100)) {
        usable = false;
        last.delete(track);
        continue;
      }
      const prev = last.get(track);
      if (prev && usable) {
        // Positive: a gap to close. Negative: this fragment starts before the last
        // one's samples end, so its last sample is shortened. Either way the
        // fragment's own start time is the truth, as in Chrome.
        const gap = time - prev.end;
        if (gap !== 0) {
          const pd = new DataView(prev.field.moof.buffer, prev.field.moof.byteOffset, prev.field.moof.byteLength);
          const adjusted = pd.getUint32(prev.field.at) + gap;
          if (adjusted >= 1 && adjusted <= 0xffffffff) {
            pd.setUint32(prev.field.at, adjusted);
            patched++;
          }
        }
      }
      let o = c.body + 8;
      if (flags & 0x1) o += 4; // data offset
      if (flags & 0x4) o += 4; // first sample flags
      let at = -1;
      for (let i = 0; i < count; i++) {
        at = o;
        time += d.getUint32(o);
        o += 4;
        if (flags & 0x200) o += 4;
        if (flags & 0x400) o += 4;
        if (flags & 0x800) o += 4;
      }
      if (at >= 0) last.set(track, { field: { moof, at }, end: time });
    }
  }
  return patched;
}

/** The fixed file, or null if it isn't an MP4. */
export async function fixMp4FragmentGaps(file: Blob): Promise<{ blob: Blob; patched: number } | null> {
  const read = async (from: number, to: number) => new Uint8Array(await file.slice(from, Math.min(to, file.size)).arrayBuffer());
  const first = await read(0, 8);
  if (first.length < 8 || type(first, 0) !== "ftyp") return null;

  const parts: BlobPart[] = [];
  const last = new Map<number, { field: DurationField; end: number }>();
  let patched = 0;
  let o = 0;
  while (o + 8 <= file.size) {
    const head = await read(o, o + 16);
    const hd = new DataView(head.buffer);
    let size = hd.getUint32(0);
    if (size === 1 && head.length >= 16) size = Number(hd.getBigUint64(8));
    if (size === 0) size = file.size - o;
    if (size < 8) break;
    const end = Math.min(o + size, file.size); // a file cut short keeps its last, partial box
    if (type(head, 0) === "moof" && end === o + size) {
      const moof = await read(o, end);
      patched += patchMoof(moof, last);
      parts.push(moof);
    } else parts.push(file.slice(o, end));
    o = end;
  }
  if (o < file.size) parts.push(file.slice(o));
  return { blob: new Blob(parts, { type: file.type }), patched };
}

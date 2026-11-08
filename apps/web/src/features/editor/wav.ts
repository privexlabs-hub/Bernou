/** A 16-bit PCM WAV file, for saving the edited audio on its own. */

export function wavHeader(frames: number, channels: number, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44);
  const d = new DataView(bytes.buffer);
  const data = frames * channels * 2;
  const text = (o: number, s: string) => [...s].forEach((c, i) => (bytes[o + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  d.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); // PCM
  d.setUint16(22, channels, true);
  d.setUint32(24, sampleRate, true);
  d.setUint32(28, sampleRate * channels * 2, true);
  d.setUint16(32, channels * 2, true);
  d.setUint16(34, 16, true);
  text(36, "data");
  d.setUint32(40, data, true);
  return bytes;
}

/** Samples in -1..1, interleaved into 16-bit little-endian PCM. */
export function pcm16(planes: Float32Array[]): Uint8Array {
  const frames = planes[0]?.length ?? 0;
  const out = new Uint8Array(frames * planes.length * 2);
  const d = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < frames; i++) {
    for (const p of planes) {
      const v = Math.max(-1, Math.min(1, p[i]!));
      d.setInt16(o, Math.round(v < 0 ? v * 32768 : v * 32767), true);
      o += 2;
    }
  }
  return out;
}

/** A whole WAV in memory: for short audio and tests. Long exports stream `wavHeader` + `pcm16` parts. */
export function wavBytes(planes: Float32Array[], sampleRate: number): Uint8Array {
  const head = wavHeader(planes[0]?.length ?? 0, planes.length, sampleRate);
  const body = pcm16(planes);
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

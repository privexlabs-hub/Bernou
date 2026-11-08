/** Adding imported audio onto the edited sound, in the export. */
import { envelopeAt } from "./ducking";

export interface MixTrack {
  /** Decoded at the mix's sample rate. */
  planes: Float32Array[];
  /** Where it starts on the output timeline, seconds. */
  start: number;
  /** How far into the file it starts, and how much of it plays (one pass). */
  trimIn: number;
  length: number;
  volumeDb: number;
  fadeIn: number;
  fadeOut: number;
  /** Repeats its trimmed part to the end of the video. */
  loop: boolean;
  /** Dips by the ducking envelope. */
  duck: boolean;
}

export class TrackMixer {
  private readonly rate: number;
  private readonly tracks: MixTrack[];
  private readonly env: Float32Array | null;
  private readonly total: number;

  constructor(o: { sampleRate: number; tracks: MixTrack[]; envelope: Float32Array | null; outputDuration: number }) {
    this.rate = o.sampleRate;
    this.tracks = o.tracks;
    this.env = o.envelope;
    this.total = o.outputDuration;
  }

  /** Adds every track into `planes`, which start at output sample `startSample`, then clamps to full scale. */
  mix(planes: Float32Array[], startSample: number) {
    const n = planes[0]?.length ?? 0;
    for (const tr of this.tracks) {
      const gain = 10 ** (tr.volumeDb / 20);
      const passLen = Math.max(0, tr.length);
      const end = tr.loop ? this.total : Math.min(this.total, tr.start + passLen);
      if (passLen <= 0) continue;
      for (let i = 0; i < n; i++) {
        const t = (startSample + i) / this.rate;
        if (t < tr.start || t >= end) continue;
        const local = (t - tr.start) % passLen;
        const src = Math.floor((tr.trimIn + local) * this.rate);
        let g = gain;
        if (tr.fadeIn > 0 && t - tr.start < tr.fadeIn) g *= (t - tr.start) / tr.fadeIn;
        if (tr.fadeOut > 0 && end - t < tr.fadeOut) g *= (end - t) / tr.fadeOut;
        if (tr.duck && this.env) g *= envelopeAt(this.env, t);
        for (let c = 0; c < planes.length; c++) {
          const p = tr.planes[Math.min(c, tr.planes.length - 1)]!;
          planes[c]![i]! += (p[src] ?? 0) * g;
        }
      }
    }
    for (const p of planes) for (let i = 0; i < p.length; i++) p[i] = Math.max(-1, Math.min(1, p[i]!));
  }
}

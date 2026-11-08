/**
 * The export's audio, as a stream: decoded source audio in, finished output
 * audio out, a second at a time, so a long recording is never held in memory.
 *
 * Per sample, in the original's time: the cut-edge fades, the crossfade weight
 * at smooth joins, and mute gain. Then, on the output timeline: noise removal
 * (its delay taken back out, blended with the original by strength), volume,
 * and a clamp to full scale.
 *
 * Pure apart from the denoiser it's given, so it runs the same in a Worker and
 * in tests.
 */
import type { EditProject } from "@/db/dexie";
import { CROSSFADE_S, normalizeRanges, type Layout } from "./timeline";

/**
 * Fade at every hard cut and at mute edges: long enough to remove the click,
 * short enough not to be heard even around a cut of a millisecond.
 */
export const EDGE_FADE_S = 0.003;

/** Processes a frame in place, values in -1..1. Its output lags its input by `delay` samples. */
export interface Denoiser {
  frameSize: number;
  delay: number;
  process(frame: Float32Array): void;
}

export interface AudioRendererOptions {
  sampleRate: number;
  channels: number;
  layout: Layout;
  project: Pick<EditProject, "audio">;
  denoiser?: (() => Denoiser) | undefined;
  /** Clamp to full scale here. Off when a mixer adds more afterwards and clamps once itself. */
  clamp?: boolean;
  /** Finished audio, in order, with its start time on the output timeline (seconds). */
  onOutput: (planes: Float32Array[], timestamp: number) => void;
}

/** A first-in, first-out run of samples. */
class Queue {
  private buf = new Float32Array(4096);
  private start = 0;
  private end = 0;
  get length() {
    return this.end - this.start;
  }
  push(data: ArrayLike<number>) {
    if (this.end + data.length > this.buf.length) {
      const live = this.buf.subarray(this.start, this.end);
      const next = this.end - this.start + data.length > this.buf.length ? new Float32Array(Math.max(this.buf.length * 2, live.length + data.length)) : this.buf;
      next.set(live, 0);
      this.buf = next;
      this.end -= this.start;
      this.start = 0;
    }
    this.buf.set(data as Float32Array, this.end);
    this.end += data.length;
  }
  take(n: number): Float32Array {
    const out = this.buf.slice(this.start, this.start + n);
    this.start += n;
    return out;
  }
  drop(n: number) {
    this.start += Math.min(n, this.length);
  }
}

export class AudioRenderer {
  private readonly rate: number;
  private readonly channels: number;
  private readonly l: Layout;
  private readonly total: number;
  private readonly fadeN: number;
  private readonly marginN: number;
  private readonly mutes;
  private readonly gain: number;
  private readonly strength: number;
  /** Output being mixed, one-second chunks keyed by index. */
  private readonly chunks = new Map<number, Float32Array[]>();
  private nextChunk = 0;
  /** After mixing: dry and denoised streams, and what's been emitted. */
  private readonly dry: Queue[] = [];
  private readonly wet: Queue[] = [];
  private readonly pending: Float32Array[] = [];
  private readonly denoisers: Denoiser[] = [];
  private wetToDrop = 0;
  private emitted = 0;
  private outQueue: Queue[] = [];
  private readonly onOutput: AudioRendererOptions["onOutput"];
  private readonly clamp: boolean;

  constructor(o: AudioRendererOptions) {
    this.rate = o.sampleRate;
    this.channels = o.channels;
    this.l = o.layout;
    this.total = Math.round(o.layout.duration * o.sampleRate);
    this.fadeN = Math.max(1, Math.round(EDGE_FADE_S * o.sampleRate));
    this.marginN = Math.ceil(CROSSFADE_S * o.sampleRate) + 1;
    this.mutes = normalizeRanges(o.project.audio.mutes, Infinity);
    this.gain = 10 ** (o.project.audio.volumeDb / 20);
    const { on, strength } = o.project.audio.denoise;
    this.strength = on && o.denoiser ? Math.min(1, Math.max(0, strength)) : 0;
    this.onOutput = o.onOutput;
    this.clamp = o.clamp ?? true;
    for (let c = 0; c < this.channels; c++) {
      this.dry.push(new Queue());
      this.wet.push(new Queue());
      this.outQueue.push(new Queue());
      this.pending.push(new Float32Array(0));
      if (this.strength > 0) this.denoisers.push(o.denoiser!());
    }
    this.wetToDrop = this.denoisers[0]?.delay ?? 0;
  }

  private chunk(index: number): Float32Array[] {
    let c = this.chunks.get(index);
    if (!c) {
      c = Array.from({ length: this.channels }, () => new Float32Array(this.rate));
      this.chunks.set(index, c);
    }
    return c;
  }

  private muteGain(t: number): number {
    let g = 1;
    for (const m of this.mutes) {
      if (t >= m.start && t < m.end) return 0;
      const d = t < m.start ? m.start - t : t - m.end;
      g = Math.min(g, d / EDGE_FADE_S);
    }
    return Math.min(1, g);
  }

  /** Decoded source audio for segment `segIndex`, starting at original time `sourceTime`. Feed segments in order. */
  push(segIndex: number, sourceTime: number, planes: Float32Array[]) {
    const seg = this.l.segments[segIndex];
    if (!seg) return;
    const segLen = Math.round((seg.end - seg.start) * this.rate);
    const segOut0 = Math.round(seg.outStart * this.rate);
    const inN = Math.round((this.l.joins[segIndex - 1]?.crossfade ?? 0) * this.rate);
    const outN = Math.round((this.l.joins[segIndex]?.crossfade ?? 0) * this.rate);
    const k0 = Math.round((sourceTime - seg.start) * this.rate);
    const n = planes[0]?.length ?? 0;
    let lastOut = segOut0 + k0;
    for (let j = 0; j < n; j++) {
      const k = k0 + j;
      if (k < 0 || k >= segLen) continue;
      let g = this.muteGain(seg.start + k / this.rate);
      // Into this segment: crossfade from the last one, or a short fade at a hard cut.
      if (inN > 0) {
        if (k < inN) g *= k / inN;
      } else if (k < this.fadeN) g *= k / this.fadeN;
      // Out of it: the matching crossfade to the next one, or a short fade.
      const fromEnd = segLen - 1 - k;
      if (outN > 0) {
        if (fromEnd < outN) g *= (fromEnd + 1) / outN;
      } else if (fromEnd < this.fadeN) g *= fromEnd / this.fadeN;
      if (g === 0) continue;
      const o = segOut0 + k;
      if (o >= this.total) continue;
      const c = this.chunk(Math.floor(o / this.rate));
      const at = o % this.rate;
      for (let ch = 0; ch < this.channels; ch++) c[ch]![at]! += (planes[Math.min(ch, planes.length - 1)]![j] ?? 0) * g;
      lastOut = o + 1;
    }
    // Nothing later can reach back further than a crossfade before this point.
    this.release(lastOut - this.marginN);
  }

  private release(upTo: number) {
    while ((this.nextChunk + 1) * this.rate <= upTo && this.nextChunk * this.rate < this.total) {
      const c = this.chunks.get(this.nextChunk) ?? this.chunk(this.nextChunk);
      this.chunks.delete(this.nextChunk);
      const len = Math.min(this.rate, this.total - this.nextChunk * this.rate);
      this.post(c.map((p) => p.subarray(0, len)));
      this.nextChunk++;
    }
  }

  /** On the output timeline: noise removal and its blend, then volume. */
  private post(planes: Float32Array[]) {
    for (let ch = 0; ch < this.channels; ch++) {
      const dry = planes[ch]!;
      if (this.strength === 0) {
        this.outQueue[ch]!.push(dry);
        continue;
      }
      this.dry[ch]!.push(dry);
      const d = this.denoisers[ch]!;
      // Whole frames through the denoiser; the remainder waits for more.
      let buf = this.pending[ch]!.length ? concat(this.pending[ch]!, dry) : dry;
      let i = 0;
      for (; i + d.frameSize <= buf.length; i += d.frameSize) {
        const frame = buf.slice(i, i + d.frameSize);
        d.process(frame);
        this.wet[ch]!.push(frame);
      }
      this.pending[ch] = buf.slice(i);
      buf = new Float32Array(0);
    }
    if (this.strength > 0) this.blend();
    this.emit(false);
  }

  private blend() {
    // The denoiser's first `delay` samples come from before the start: drop them, so wet lines up with dry.
    if (this.wetToDrop > 0) {
      const n = Math.min(this.wetToDrop, ...this.wet.map((q) => q.length));
      for (const q of this.wet) q.drop(n);
      this.wetToDrop -= n;
      if (this.wetToDrop > 0) return;
    }
    const n = Math.min(...this.dry.map((q) => q.length), ...this.wet.map((q) => q.length));
    if (n <= 0) return;
    const s = this.strength;
    for (let ch = 0; ch < this.channels; ch++) {
      const dry = this.dry[ch]!.take(n);
      const wet = this.wet[ch]!.take(n);
      for (let i = 0; i < n; i++) dry[i] = (1 - s) * dry[i]! + s * wet[i]!;
      this.outQueue[ch]!.push(dry);
    }
  }

  private emit(all: boolean) {
    const ready = Math.min(...this.outQueue.map((q) => q.length));
    const n = Math.min(all ? ready : ready - (ready % this.rate), this.total - this.emitted);
    if (n <= 0) return;
    const planes = this.outQueue.map((q) => {
      const p = q.take(n);
      for (let i = 0; i < p.length; i++) p[i] = this.clamp ? Math.max(-1, Math.min(1, p[i]! * this.gain)) : p[i]! * this.gain;
      return p;
    });
    this.onOutput(planes, this.emitted / this.rate);
    this.emitted += n;
  }

  /** After the last push: everything still held goes out. */
  finish() {
    this.release(Infinity);
    if (this.strength > 0) {
      // Push silence through the denoiser until it has given back everything it holds.
      const d = this.denoisers[0]!;
      const flush = new Float32Array(d.delay + d.frameSize);
      while (this.wet[0]!.length - this.wetToDrop < this.dry[0]!.length) {
        for (let ch = 0; ch < this.channels; ch++) {
          const buf = concat(this.pending[ch]!, flush);
          let i = 0;
          for (; i + this.denoisers[ch]!.frameSize <= buf.length; i += this.denoisers[ch]!.frameSize) {
            const frame = buf.slice(i, i + this.denoisers[ch]!.frameSize);
            this.denoisers[ch]!.process(frame);
            this.wet[ch]!.push(frame);
          }
          this.pending[ch] = buf.slice(i);
        }
      }
      this.blend();
    }
    this.emit(true);
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

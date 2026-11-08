/**
 * The editor's preview playback.
 *
 * Sound is the decoded original, scheduled segment by segment through Web
 * Audio: cuts, the short fades, smooth-join crossfades, mutes, volume and
 * noise removal sound as they'll be exported. The video element is muted and
 * follows the audio clock, jumping at each cut, so the picture can hold a
 * frame there. A smooth join's picture blend is only shown by rendering it.
 */
import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorklet from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasm from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimd from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import type { EditProject } from "@/db/dexie";
import { EDGE_FADE_S } from "./audioRender";
import { normalizeRanges, sourcesAt, type Layout } from "./timeline";
import { ENVELOPE_RATE } from "./ducking";

/** What the preview needs beyond the project: decoded added audio and the music dip. */
export interface PlayExtras {
  trackBuffer: (assetId: string) => AudioBuffer | null;
  envelope: Float32Array | null;
}

/** The live worklet's delay: its 1,920-sample ring reads 640 behind, plus the model's 960. */
const WORKLET_DELAY_SAMPLES = 640 + 960;

export class PreviewPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private wasm: Promise<ArrayBuffer> | null = null;
  private nodes: AudioScheduledSourceNode[] = [];
  private stopGraph: (() => void) | null = null;
  private raf = 0;
  private startCtx = 0;
  private startOut = 0;
  playing = false;

  constructor(
    private video: HTMLVideoElement,
    private onTime: (outTime: number, sourceTime: number) => void,
    private onEnded: () => void,
  ) {}

  /** The decoded original, mono. */
  setAudio(samples: Float32Array, sampleRate: number) {
    this.ctx ??= new AudioContext({ sampleRate: sampleRate || 48000 });
    if (samples.length === 0) return;
    const b = this.ctx.createBuffer(1, samples.length, sampleRate);
    b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    this.buffer = b;
  }

  /** The decoded recording sound, mono, without a copy: for the waveform and silence finding. */
  originalSamples(): { samples: Float32Array; rate: number } | null {
    return this.buffer ? { samples: this.buffer.getChannelData(0), rate: this.buffer.sampleRate } : null;
  }

  /** Where the picture should be at an output time: the side that dominates a join. */
  private sourceFor(l: Layout, out: number): number | null {
    const s = sourcesAt(l, out);
    if (s.length === 0) return null;
    return (s.length > 1 && s[1]!.weight >= 0.5 ? s[1]! : s[0]!).t;
  }

  /** Paused: show the frame at an output time. */
  async seek(l: Layout, out: number) {
    const t = this.sourceFor(l, Math.min(out, Math.max(0, l.duration - 1e-3)));
    if (t === null) return;
    this.startOut = out;
    this.video.currentTime = t;
    this.onTime(out, t);
  }

  async play(l: Layout, project: EditProject, fromOut: number, extras: PlayExtras = { trackBuffer: () => null, envelope: null }) {
    this.stop();
    if (!this.ctx) this.ctx = new AudioContext();
    await this.ctx.resume();
    if (fromOut >= l.duration) fromOut = 0;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.12; // time to set up, so nothing starts in the past
    this.startCtx = t0;
    this.startOut = fromOut;
    await this.scheduleAudio(ctx, l, project, fromOut, t0, extras);
    this.playing = true;
    this.video.muted = true;
    const first = this.sourceFor(l, fromOut);
    if (first !== null) this.video.currentTime = first;
    void this.video.play().catch(() => undefined);
    const frame = 1 / 30;
    const tick = () => {
      if (!this.playing) return;
      const out = this.startOut + Math.max(0, ctx.currentTime - this.startCtx);
      if (out >= l.duration) {
        this.stop();
        this.onTime(l.duration, this.sourceFor(l, l.duration - 1e-3) ?? 0);
        return this.onEnded();
      }
      // Look a frame ahead, so a removed section doesn't flash before the jump.
      const t = this.sourceFor(l, out + frame) ?? this.sourceFor(l, out);
      if (t !== null && Math.abs(this.video.currentTime - t) > 0.2) this.video.currentTime = t;
      this.onTime(out, this.sourceFor(l, out) ?? 0);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private async scheduleAudio(ctx: AudioContext, l: Layout, project: EditProject, fromOut: number, t0: number, extras: PlayExtras) {
    const bus = ctx.createGain();
    const volume = ctx.createGain();
    volume.gain.value = 10 ** (project.audio.volumeDb / 20);
    const cleanup: (() => void)[] = [];
    const cleanupNodes: AudioNode[] = [];
    const { on, strength } = project.audio.denoise;
    if (on && strength > 0) {
      this.wasm ??= loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimd }).then(async (w) => {
        await ctx.audioWorklet.addModule(rnnoiseWorklet);
        return w;
      });
      const wasmBinary = await this.wasm;
      const wet = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
      const wetGain = ctx.createGain();
      wetGain.gain.value = strength;
      // The original, held back by the worklet's delay, so the blend doesn't echo.
      const dry = ctx.createDelay(1);
      dry.delayTime.value = WORKLET_DELAY_SAMPLES / ctx.sampleRate;
      const dryGain = ctx.createGain();
      dryGain.gain.value = 1 - strength;
      bus.connect(wet).connect(wetGain).connect(volume);
      bus.connect(dry).connect(dryGain).connect(volume);
      cleanup.push(() => wet.port.postMessage("destroy"));
    } else bus.connect(volume);
    volume.connect(ctx.destination);

    const mutes = normalizeRanges(project.audio.mutes, Infinity);
    const at = (out: number) => t0 + (out - fromOut);
    // The recording's own sound: off, or read shifted by its offset (sound time = picture time − offset).
    const offset = project.audio.original.offsetMs / 1000;
    const original = project.audio.original.on ? this.buffer : null;
    if (original) l.segments.forEach((seg, i) => {
      const len = seg.end - seg.start;
      const outEnd = seg.outStart + len;
      if (outEnd <= fromOut) return;
      const skip = Math.max(0, fromOut - seg.outStart);
      const src = ctx.createBufferSource();
      src.buffer = original;
      const edges = ctx.createGain();
      const muteGain = ctx.createGain();
      src.connect(edges).connect(muteGain).connect(bus);
      // Into and out of the segment: a crossfade at smooth joins, else the short fade.
      // Never more than half the segment each, or the two ramps' events would overlap.
      const inF = Math.min(l.joins[i - 1]?.crossfade || EDGE_FADE_S, len / 2);
      const outF = Math.min(l.joins[i]?.crossfade || EDGE_FADE_S, len / 2);
      const g = edges.gain;
      g.setValueAtTime(skip > 0 ? Math.min(1, skip / inF) : 0, at(seg.outStart + skip));
      if (skip < inF) g.linearRampToValueAtTime(1, at(seg.outStart + inF));
      g.setValueAtTime(1, at(Math.max(seg.outStart + skip, outEnd - outF)));
      g.linearRampToValueAtTime(0, at(outEnd));
      // Mutes, in the original's time, with short ramps just outside them.
      const m = muteGain.gain;
      m.setValueAtTime(1, at(seg.outStart + skip));
      for (const r of mutes) {
        const a = Math.max(r.start, seg.start + skip);
        const b = Math.min(r.end, seg.end);
        if (b <= a) continue;
        const outA = seg.outStart + (a - seg.start);
        const outB = seg.outStart + (b - seg.start);
        m.setValueAtTime(1, at(Math.max(seg.outStart + skip, outA - EDGE_FADE_S)));
        m.linearRampToValueAtTime(0, at(outA));
        m.setValueAtTime(0, at(outB));
        m.linearRampToValueAtTime(1, at(outB + EDGE_FADE_S));
      }
      // Shifted, the read can fall before the file's start or past its end: start later, or stop sooner, instead.
      let readFrom = seg.start + skip - offset;
      let when = at(seg.outStart + skip);
      let dur = len - skip;
      if (readFrom < 0) {
        when -= readFrom;
        dur += readFrom;
        readFrom = 0;
      }
      dur = Math.min(dur, original.duration - readFrom);
      if (dur > 0) {
        src.start(when, readFrom, dur);
        this.nodes.push(src);
      }
    });

    // Added tracks, on the output timeline.
    for (const t of project.audio.tracks) {
      const buf = extras.trackBuffer(t.assetId);
      if (!buf || t.length <= 0) continue;
      const end = t.loop ? l.duration : Math.min(l.duration, t.start + t.length);
      if (end <= fromOut) continue;
      const g = ctx.createGain();
      const level = 10 ** (t.volumeDb / 20);
      // Fades and volume, in output time from where playback starts.
      const gainAt = (out: number) => level * (t.fadeIn > 0 ? Math.min(1, Math.max(0, (out - t.start) / t.fadeIn)) : 1) * (t.fadeOut > 0 ? Math.min(1, Math.max(0, (end - out) / t.fadeOut)) : 1);
      const startOut = Math.max(fromOut, t.start);
      g.gain.setValueAtTime(gainAt(startOut), at(startOut));
      if (t.fadeIn > 0 && startOut < t.start + t.fadeIn) g.gain.linearRampToValueAtTime(level, at(t.start + t.fadeIn));
      if (t.fadeOut > 0) {
        g.gain.setValueAtTime(gainAt(Math.max(startOut, end - t.fadeOut)), at(Math.max(startOut, end - t.fadeOut)));
        g.gain.linearRampToValueAtTime(0, at(end));
      }
      let out: AudioNode = g;
      // The music dip: the same envelope the export uses, from where playback starts.
      if (t.duck && extras.envelope) {
        const duck = ctx.createGain();
        const i0 = Math.min(extras.envelope.length - 1, Math.floor(startOut * ENVELOPE_RATE));
        const curve = extras.envelope.slice(i0);
        if (curve.length >= 2) duck.gain.setValueCurveAtTime(curve, at(i0 / ENVELOPE_RATE), (curve.length - 1) / ENVELOPE_RATE);
        g.connect(duck);
        out = duck;
      }
      out.connect(ctx.destination);
      // One source per pass; looping repeats the trimmed part to the end.
      for (let passStart = t.start; passStart < end; passStart += t.length) {
        const passEnd = Math.min(end, passStart + t.length);
        if (passEnd <= fromOut) {
          if (!t.loop) break;
          continue;
        }
        const from = Math.max(fromOut, passStart);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.start(at(from), t.trimIn + (from - passStart), passEnd - from);
        this.nodes.push(src);
        if (!t.loop) break;
      }
      cleanupNodes.push(g, out);
    }
    this.stopGraph = () => {
      for (const c of cleanup) c();
      bus.disconnect();
      volume.disconnect();
      for (const n of cleanupNodes) n.disconnect();
    };
  }

  /** The output time now. */
  position(): number {
    return this.playing && this.ctx ? this.startOut + Math.max(0, this.ctx.currentTime - this.startCtx) : this.startOut;
  }

  stop() {
    if (this.playing) this.startOut = this.position();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* never started */
      }
    }
    this.nodes = [];
    this.stopGraph?.();
    this.stopGraph = null;
    this.video.pause();
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

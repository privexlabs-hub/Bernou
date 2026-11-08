/// <reference lib="webworker" />
/**
 * The editor's export, in a Worker so a long export doesn't freeze the page.
 * Reads the original, renders each output frame and the audio, encodes them,
 * and writes the file to OPFS as it goes. The original is only ever read.
 */
import { ALL_FORMATS, AudioSample, AudioSampleSink, AudioSampleSource, BlobSource, CanvasSource, canEncodeAudio, canEncodeVideo, Input, Mp4OutputFormat, Output, StreamTarget, VideoSampleSink, WebMOutputFormat, type InputAudioTrack, type InputVideoTrack, type VideoSample } from "mediabunny";
import { Rnnoise } from "@shiguredo/rnnoise-wasm";
import { AudioRenderer, type Denoiser } from "../audioRender";
import { TrackMixer } from "../mixTracks";
import { drawFrame, type FrameLayer } from "../render";
import { layout, sourcesAt, type Layout } from "../timeline";
import { pcm16, wavHeader } from "../wav";
import type { EditProject } from "@/db/dexie";
import { outputDir, type ExportResult, type FromWorker, type SourceInfo, type ToWorker } from "./protocol";

const FPS = 30;
/** The model's own measured delay: its output lags its input by two frames. */
const RNNOISE_DELAY = 960;
const RNNOISE_RATE = 48000;

const send = (m: FromWorker, transfer: Transferable[] = []) => postMessage(m, { transfer });
let cancelled = false;

async function open(file: Blob) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  return { input, video: await input.getPrimaryVideoTrack(), audio: await input.getPrimaryAudioTrack() };
}

async function chooseOutput(w: number, h: number, hasAudio: boolean, bitrate: number): Promise<SourceInfo["output"]> {
  const audio = { numberOfChannels: 2, sampleRate: 48000, bitrate: 128_000 };
  // The check uses exactly the settings the export will: Firefox can do VP9, but not in hardware.
  const video = async (codec: "avc" | "vp9" | "vp8") => {
    for (const hardware of ["prefer-hardware", "no-preference"] as const) if (await canEncodeVideo(codec, { width: w, height: h, bitrate, hardwareAcceleration: hardware })) return hardware;
    return null;
  };
  // MP4 with H.264 and AAC plays everywhere, QuickTime included. Opus in MP4 doesn't, so the fallback is WebM.
  const avc = await video("avc");
  if (avc && (!hasAudio || (await canEncodeAudio("aac", audio)))) return { container: "mp4", video: "avc", audio: hasAudio ? "aac" : null, hardware: avc };
  for (const v of ["vp9", "vp8"] as const) {
    const hw = await video(v);
    if (hw && (!hasAudio || (await canEncodeAudio("opus", audio)))) return { container: "webm", video: v, audio: hasAudio ? "opus" : null, hardware: hw };
  }
  return null;
}

async function probe(file: Blob): Promise<SourceInfo> {
  const { input, video, audio } = await open(file);
  const duration = await input.computeDuration();
  const width = video?.displayWidth ?? 0;
  const height = video?.displayHeight ?? 0;
  const bitrate = sourceBitrate(file, duration);
  return {
    duration,
    width,
    height,
    hasAudio: !!audio,
    sampleRate: audio?.sampleRate ?? 0,
    channels: audio?.numberOfChannels ?? 0,
    output: video ? await chooseOutput(width, height, !!audio, bitrate) : null,
    denoiseUnavailable: !audio ? "This recording has no sound." : audio.sampleRate !== RNNOISE_RATE ? `Noise removal needs 48 kHz audio; this recording's is ${audio.sampleRate / 1000} kHz.` : null,
  };
}

/** Roughly the original's bitrate, so the export is about the same quality and size. */
const sourceBitrate = (file: Blob, duration: number) => Math.max(1_000_000, Math.min(20_000_000, Math.round((file.size * 8) / Math.max(1, duration))));

/** All channels of a decoded sample, as separate planes. */
function planes(s: { numberOfChannels: number; allocationSize: (o: { planeIndex: number; format: "f32-planar" }) => number; copyTo: (d: Float32Array, o: { planeIndex: number; format: "f32-planar" }) => void }): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < s.numberOfChannels; c++) {
    const p = new Float32Array(s.allocationSize({ planeIndex: c, format: "f32-planar" }) / 4);
    s.copyTo(p, { planeIndex: c, format: "f32-planar" });
    out.push(p);
  }
  return out;
}

async function decodeAudio(id: number, file: Blob, peaksPerSecond: number) {
  const { audio } = await open(file);
  if (!audio) return send({ type: "decodeAudio", id, samples: new Float32Array(0), sampleRate: 0, peaks: new Float32Array(0) });
  const rate = audio.sampleRate;
  const duration = await audio.computeDuration();
  const samples = new Float32Array(Math.ceil(duration * rate) + rate);
  const per = Math.max(1, Math.round(rate / peaksPerSecond));
  const peaks = new Float32Array(Math.ceil(samples.length / per));
  for await (const s of new AudioSampleSink(audio).samples()) {
    const ps = planes(s);
    const at = Math.round(s.timestamp * rate);
    s.close();
    for (let i = 0; i < ps[0]!.length; i++) {
      let v = 0;
      for (const p of ps) v += p[i]!;
      v /= ps.length;
      const o = at + i;
      if (o < 0 || o >= samples.length) continue;
      samples[o] = v;
      const k = Math.floor(o / per);
      peaks[k] = Math.max(peaks[k]!, Math.abs(v));
    }
  }
  send({ type: "decodeAudio", id, samples, sampleRate: rate, peaks }, [samples.buffer, peaks.buffer]);
}

let rnnoise: Rnnoise | null = null;
async function makeDenoiser(): Promise<() => Denoiser> {
  rnnoise ??= await Rnnoise.load();
  const model = rnnoise;
  return () => {
    const state = model.createDenoiseState();
    const scratch = new Float32Array(model.frameSize);
    return {
      frameSize: model.frameSize,
      delay: RNNOISE_DELAY,
      process(frame) {
        // The model works on 16-bit-scale samples.
        for (let i = 0; i < frame.length; i++) scratch[i] = frame[i]! * 32767;
        state.processFrame(scratch);
        for (let i = 0; i < frame.length; i++) frame[i] = scratch[i]! / 32767;
      },
    };
  };
}

/**
 * The recording's own sound, edited, giving each finished piece to `out`. Read
 * shifted by its offset (sound time = picture time − offset), and placed in
 * picture time, so mutes and fades stay where they are on the picture.
 */
async function renderAudio(track: InputAudioTrack, l: Layout, project: EditProject, channels: number, out: (planes: Float32Array[], timestamp: number) => Promise<void>) {
  const denoise = project.audio.denoise.on && track.sampleRate === RNNOISE_RATE ? await makeDenoiser() : undefined;
  const ready: [Float32Array[], number][] = [];
  const offset = project.audio.original.offsetMs / 1000;
  // Unclamped: the mixer adds tracks and clamps once.
  const r = new AudioRenderer({ sampleRate: track.sampleRate, channels, layout: l, project, denoiser: denoise, clamp: false, onOutput: (p, t) => ready.push([p, t]) });
  const drain = async () => {
    while (ready.length) {
      const [p, t] = ready.shift()!;
      await out(p, t);
    }
  };
  const sink = new AudioSampleSink(track);
  for (let i = 0; i < l.segments.length; i++) {
    const seg = l.segments[i]!;
    // Where the shift reaches before the file's start or past its end there's nothing to read: silence.
    if (seg.end - offset <= 0) continue;
    for await (const s of sink.samples(Math.max(0, seg.start - offset), seg.end - offset)) {
      if (cancelled) return s.close();
      const p = planes(s);
      const t = s.timestamp + offset;
      s.close();
      r.push(i, t, p);
      await drain();
    }
  }
  r.finish();
  await drain();
}

/**
 * All the edited sound: the recording's own (unless it's off or absent) with
 * the added tracks mixed on top, clamped once. `fullDuration` and `from` place
 * a slice (a join preview) on the whole output's timeline.
 */
async function produceAudio(m: Extract<ToWorker, { type: "export" }>, original: InputAudioTrack | null, l: Layout, fullDuration: number, out: (planes: Float32Array[], timestamp: number) => Promise<void>) {
  const { rate, channels, tracks, envelope } = m.audio;
  const mixer = new TrackMixer({ sampleRate: rate, tracks, envelope, outputDuration: fullDuration, timeOffset: m.range?.from ?? 0 });
  const emit = async (p: Float32Array[], t: number) => {
    mixer.mix(p, Math.round(t * rate));
    await out(p, t);
  };
  if (original && m.project.audio.original.on) {
    if (original.sampleRate !== rate) throw new Error(`The mix is at ${rate} Hz but the recording's sound is at ${original.sampleRate} Hz.`);
    return renderAudio(original, l, m.project, channels, emit);
  }
  // No recording sound: the tracks over silence, a second at a time.
  const total = Math.round(l.duration * rate);
  for (let at = 0; at < total && !cancelled; at += rate) {
    const n = Math.min(rate, total - at);
    await emit(Array.from({ length: channels }, () => new Float32Array(n)), at / rate);
  }
}

/** Pulls frames for a list of times, in order, from one decoder. */
function frameStream(track: InputVideoTrack, times: number[]) {
  const it = new VideoSampleSink(track).samplesAtTimestamps(times)[Symbol.asyncIterator]();
  return async (): Promise<VideoSample | null> => {
    const n = await it.next();
    return n.done ? null : n.value;
  };
}

async function exportFile(m: Extract<ToWorker, { type: "export" }>) {
  cancelled = false;
  const { input, video, audio } = await open(m.file);
  const duration = await input.computeDuration();
  const full = layout({ duration, trim: m.project.trim, cuts: m.project.cuts, smoothJoins: m.project.smoothJoins });
  // A range (for previewing one join) is a slice of the output timeline.
  const l = m.range ? sliceLayout(full, m.range.from, m.range.to) : full;
  const root = await outputDir(m.dir);
  const handle = await root.getFileHandle(m.fileName, { create: true });
  const remove = () => root.removeEntry(m.fileName).catch(() => undefined);

  const hasSound = (!!audio && m.project.audio.original.on) || m.audio.tracks.length > 0;
  if (m.audioOnly) {
    if (!hasSound) throw new Error("There's no sound to save: the recording's sound is off and no audio is added");
    const writable = await handle.createWritable();
    const frames = Math.round(l.duration * m.audio.rate);
    await writable.write(wavHeader(frames, m.audio.channels, m.audio.rate) as Uint8Array<ArrayBuffer>);
    await produceAudio(m, audio, l, full.duration, async (p, t) => {
      await writable.write(pcm16(p) as Uint8Array<ArrayBuffer>);
      send({ type: "progress", id: m.id, done: Math.round(t * 1000), total: Math.round(l.duration * 1000) });
    });
    if (cancelled) {
      await writable.abort();
      await remove();
      return result(m, null, true);
    }
    await writable.close();
    const file = await handle.getFile();
    return result(m, { bytes: file.size, durationMs: l.duration * 1000, mime: "audio/wav", extension: "wav", width: 0, height: 0 }, false);
  }

  if (!video) throw new Error("This recording has no video.");
  const w = video.displayWidth;
  const h = video.displayHeight;
  const bitrate = sourceBitrate(m.file, duration);
  // With no sound at all, the export has no audio track.
  const choice = await chooseOutput(w, h, hasSound, bitrate);
  if (!choice) throw new Error("This browser can't encode video. Try Chrome or Edge.");
  const writable = await handle.createWritable();
  const output = new Output({
    format: choice.container === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
    target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
  });
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const vsrc = new CanvasSource(canvas, { codec: choice.video as "avc", bitrate, keyFrameInterval: 2, hardwareAcceleration: choice.hardware });
  output.addVideoTrack(vsrc, { frameRate: FPS });
  const asrc = hasSound && choice.audio ? new AudioSampleSource({ codec: choice.audio as "aac", bitrate: 128_000 }) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();

  // Every output frame shows the source frame that was on screen at its moment:
  // the frame grid is steady 30 fps whatever the original's timing.
  const total = Math.round(l.duration * FPS);
  const layers = Array.from({ length: total }, (_, i) => sourcesAt(l, i / FPS));
  const first = frameStream(video, layers.map((s) => s[0]!.t));
  const second = frameStream(video, layers.filter((s) => s.length > 1).map((s) => s[1]!.t));

  const videoJob = (async () => {
    for (let i = 0; i < total && !cancelled; i++) {
      const at = layers[i]!;
      const samples = [await first(), at.length > 1 ? await second() : null];
      const drawn: FrameLayer[] = [];
      const frames: VideoFrame[] = [];
      at.forEach((s, k) => {
        const sample = samples[k];
        if (!sample) return;
        const f = sample.toVideoFrame();
        frames.push(f);
        drawn.push({ image: f, weight: s.weight, t: s.t });
      });
      if (drawn.length === 0) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
      } else drawFrame(ctx, drawn, w, h, m.project.picture, m.project.overlays);
      for (const f of frames) f.close();
      for (const s of samples) s?.close();
      await vsrc.add(i / FPS, 1 / FPS);
      if (i % 15 === 0) send({ type: "progress", id: m.id, done: i, total });
    }
  })();
  const audioJob = asrc ? produceAudio(m, audio, l, full.duration, (p, t) => asrc.add(new AudioSample({ data: interleavePlanar(p), format: "f32-planar", numberOfChannels: p.length, sampleRate: m.audio.rate, timestamp: t }))) : Promise.resolve();

  try {
    await Promise.all([videoJob, audioJob]);
  } catch (e) {
    await output.cancel().catch(() => undefined);
    await remove();
    throw e;
  }
  if (cancelled) {
    await output.cancel().catch(() => undefined);
    await remove();
    return result(m, null, true);
  }
  await output.finalize();
  const file = await handle.getFile();
  return result(m, { bytes: file.size, durationMs: l.duration * 1000, mime: choice.container === "mp4" ? "video/mp4" : "video/webm", extension: choice.container, width: w, height: h }, false);
}

/** f32-planar: each channel's samples one after another. */
function interleavePlanar(p: Float32Array[]): Float32Array {
  const out = new Float32Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of p) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

/** The part of a layout between two output times, as a layout of its own. */
function sliceLayout(l: Layout, from: number, to: number): Layout {
  from = Math.max(0, from);
  to = Math.min(l.duration, to);
  const segments = l.segments
    .map((s) => {
      const outEnd = s.outStart + (s.end - s.start);
      const a = Math.max(s.outStart, from);
      const b = Math.min(outEnd, to);
      return b > a ? { start: s.start + (a - s.outStart), end: s.start + (b - s.outStart), outStart: a - from } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  const joins = segments.slice(1).map((s, i) => ({ crossfade: Math.max(0, segments[i]!.outStart + (segments[i]!.end - segments[i]!.start) - s.outStart) }));
  return { segments, joins, duration: Math.max(0, to - from) };
}

function result(m: { id: number; fileName: string }, r: Omit<ExportResult, "fileName" | "cancelled"> | null, wasCancelled: boolean) {
  send({ type: "export", id: m.id, result: { fileName: m.fileName, bytes: 0, durationMs: 0, mime: "", extension: "", width: 0, height: 0, ...r, cancelled: wasCancelled } });
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "cancel") {
    cancelled = true;
    return;
  }
  try {
    if (m.type === "probe") send({ type: "probe", id: m.id, info: await probe(m.file) });
    if (m.type === "decodeAudio") await decodeAudio(m.id, m.file, m.peaksPerSecond);
    if (m.type === "export") await exportFile(m);
  } catch (err) {
    send({ type: "error", id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
};

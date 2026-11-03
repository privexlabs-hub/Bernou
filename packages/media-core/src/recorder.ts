/**
 * Records a canvas plus an audio track. Framework-free: it takes the tracks it
 * records and knows nothing about stores. Reached through the
 * `@bernou/media-core/recorder` subpath so audience code can never pull it in.
 */
export * from "./recorderStorage";
export * from "./recorderWebm";

export interface RecordingFormat {
  mimeType: string;
  /** The type to label the finished file with. */
  fileType: string;
  extension: "mp4" | "webm";
}

/** MP4 first: AAC plays in QuickTime and most editors, H.264/Opus in fewer. */
const FORMATS: RecordingFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.640028,mp4a.40.2", fileType: "video/mp4", extension: "mp4" },
  { mimeType: "video/mp4;codecs=avc1.640028,opus", fileType: "video/mp4", extension: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", fileType: "video/webm", extension: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", fileType: "video/webm", extension: "webm" },
  { mimeType: "video/webm", fileType: "video/webm", extension: "webm" },
];

export function pickRecordingFormat(isSupported: (mimeType: string) => boolean): RecordingFormat | null {
  return FORMATS.find((f) => isSupported(f.mimeType)) ?? null;
}

export function videoBitrate(height: number): number {
  return height >= 1080 ? 6_000_000 : height >= 720 ? 4_000_000 : 2_000_000;
}

const AUDIO_BITRATE = 128_000;
const CHUNK_MS = 1000;
/**
 * MP4 data only comes out a keyframe at a time, and by default those are far
 * apart: 6s in, a file was still just its header. This bounds what a crash loses.
 */
const KEYFRAME_MS = 2000;
const FRAME_MS = 33;

/**
 * Waits for each tick to be acknowledged before sending the next. Otherwise a
 * machine that can't draw in time builds up an endless queue of ticks and the
 * page stops responding, when losing some frames is all that should happen.
 */
const CLOCK_SRC = `let ready = true;
onmessage = () => { ready = true; };
setInterval(() => { if (ready) { ready = false; postMessage(0); } }, ${FRAME_MS});`;

export interface CanvasRecording {
  /** Stops at once; resolves after the last chunk has been delivered. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * The clock is a worker because tab timers and animation frames slow or stop in
 * a hidden tab, and a presenter sharing into Zoom usually has this tab hidden.
 * captureStream(30) missed a slide change while hidden when measured. A canvas
 * emits a frame only if drawn since the last one, requestFrame included, so
 * `draw` runs on every tick or a still slide would stall the video.
 */
export function recordCanvas(opts: {
  canvas: HTMLCanvasElement;
  /** Redraws the canvas. */
  draw: () => void;
  audioTrack: MediaStreamTrack;
  format: RecordingFormat;
  onChunk: (chunk: Blob) => void;
  onError: (message: string) => void;
}): CanvasRecording {
  const stream = opts.canvas.captureStream(0);
  const video = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  stream.addTrack(opts.audioTrack);

  const clock = new Worker(URL.createObjectURL(new Blob([CLOCK_SRC], { type: "text/javascript" })));
  clock.onmessage = () => {
    opts.draw();
    video.requestFrame();
    clock.postMessage(0);
  };

  const recorder = new MediaRecorder(stream, {
    mimeType: opts.format.mimeType,
    videoBitsPerSecond: videoBitrate(opts.canvas.height),
    audioBitsPerSecond: AUDIO_BITRATE,
    videoKeyFrameIntervalDuration: KEYFRAME_MS,
  } as MediaRecorderOptions);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) opts.onChunk(e.data);
  };
  recorder.onerror = (e) => opts.onError((e as unknown as { error?: Error }).error?.message ?? "the browser stopped the recording");

  const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
  recorder.start(CHUNK_MS);

  return {
    stop() {
      clock.terminate();
      if (recorder.state !== "inactive") recorder.stop();
      // Only the canvas track is ours: the audio track belongs to the audio graph.
      video.stop();
      return stopped;
    },
  };
}

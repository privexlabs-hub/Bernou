/**
 * Runs one recording: the preview canvas (the audience composition, nothing
 * else) plus the audio graph's output. Publishes nothing: recording state never
 * reaches the audience payload or channel.
 */
import { createMemorySink, deleteRecordingFile, listRecordingFiles, openOpfsSink, pickRecordingFormat, readRecordingFile, recordCanvas, type CanvasRecording, type RecordingSink } from "@bernou/media-core/recorder";
import { db, type RecordingRecord } from "@/db/dexie";
import { addRecording, updateRecording } from "@/db/repositories/recordings";
import { getSession } from "@/db/repositories/sessions";
import { getSetting } from "@/db/repositories/settings";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "@/features/dashboard/SettingsDialog";
import { getPreviewHandle } from "@/features/preview/previewHandle";
import { registerStopper } from "@/features/safety/emergencyStop";
import { newId } from "@/lib/id";
import { useDevicesStore } from "@/stores/private/devicesStore";
import { useRecordingStore } from "@/stores/private/recordingStore";
import { useSessionStore } from "@/stores/private/sessionStore";

const MB = 1024 * 1024;
const WARN_BEFORE_START = 500 * MB;
const AUTO_STOP_BELOW = 50 * MB;
const WARN_MINUTES_LEFT = 5;
const MEMORY_CAP = 500 * MB;
const PROGRESS_SAVE_MS = 5000;

const lockName = (id: string) => `bernou-recording-${id}`;

interface Active {
  row: RecordingRecord;
  sink: RecordingSink;
  capture: CanvasRecording;
  startedAt: number;
  progress: ReturnType<typeof setInterval>;
  releaseLock: () => void;
  stopping: Promise<void> | null;
  failure: string | null;
}

let active: Active | null = null;
/** Bumped by a stop that arrives while a start is still preparing. */
let startOp = 0;

const store = () => useRecordingStore.getState();

async function freeSpace(): Promise<number | null> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    return quota === undefined || usage === undefined ? null : quota - usage;
  } catch {
    return null;
  }
}

/** Held until the file is finalised, so a later boot can tell a crash from a recording in another tab. */
function holdLock(id: string): () => void {
  if (!navigator.locks) return () => undefined;
  let release = () => undefined as void;
  const held = new Promise<void>((resolve) => (release = resolve));
  void navigator.locks.request(lockName(id), () => held);
  return release;
}

export async function startRecording(): Promise<void> {
  if (store().status !== "idle") return;
  const op = ++startOp;
  store().set({ status: "preparing", error: null, warning: null, finished: null, lastOutcome: null });
  const fail = (error: string) => store().set({ status: "idle", error });

  const preview = getPreviewHandle();
  const format = typeof MediaRecorder === "undefined" ? null : pickRecordingFormat((m) => MediaRecorder.isTypeSupported(m));
  if (!preview) return fail("The preview isn't ready yet. Try again in a moment.");
  const { canvas, draw } = preview;
  if (!format) return fail("This browser can't record video.");

  const graph = await useDevicesStore.getState().ensureAudioGraph();
  if (op !== startOp) return;

  const free = await freeSpace();
  if (op !== startOp) return;
  if (free !== null && free < AUTO_STOP_BELOW) return fail("There isn't enough storage space to record. Delete old recordings and try again.");
  let warning = free !== null && free < WARN_BEFORE_START ? `Low storage: about ${Math.round(free / MB)} MB free.` : null;

  const settings = await getSetting<AppSettings>("app", DEFAULT_APP_SETTINGS);
  if (settings.requestPersistentStorage) void navigator.storage?.persist?.().catch(() => undefined);

  const id = newId();
  const fileName = `${id}.${format.extension}`;
  let sink: RecordingSink;
  try {
    sink = await openOpfsSink(fileName);
  } catch {
    sink = createMemorySink(fileName, MEMORY_CAP);
    warning = "This browser can't save while recording: download the file before closing this tab, and it stops at 500 MB.";
  }
  if (op !== startOp) {
    await sink.close().catch(() => undefined);
    await deleteRecordingFile(fileName).catch(() => undefined);
    return;
  }

  // From the database: the store keeps the title the session was opened with.
  const sessionId = useSessionStore.getState().session?.id ?? null;
  const title = (sessionId && (await getSession(sessionId))?.title) || "Recording";

  const startedAt = Date.now();
  const row: RecordingRecord = {
    id,
    sessionId,
    title,
    createdAt: startedAt,
    durationMs: 0,
    mime: format.fileType,
    extension: format.extension,
    bytes: 0,
    width: canvas.width,
    height: canvas.height,
    opfsPath: fileName,
    savedToDisk: false,
    status: "recording",
  };
  await addRecording(row);
  if (op !== startOp) {
    await sink.close().catch(() => undefined);
    await deleteRecordingFile(fileName).catch(() => undefined);
    await db().recordings.delete(id);
    return;
  }

  const stopOnFailure = (message: string) => {
    if (active) active.failure ??= message;
    void stopRecording({ quiet: false });
  };

  let capture: CanvasRecording;
  try {
    capture = recordCanvas({
      canvas,
      draw,
      audioTrack: graph.outputStream.getAudioTracks()[0]!,
      format,
      onChunk: (chunk) => void sink.write(chunk).catch((e: Error) => stopOnFailure(e.name === "QuotaExceededError" || /Quota/i.test(e.message) ? "Storage ran out." : `Saving failed (${e.message}).`)),
      onError: (message) => stopOnFailure(`Recording stopped: ${message}.`),
    });
  } catch (e) {
    await sink.close().catch(() => undefined);
    await deleteRecordingFile(fileName).catch(() => undefined);
    await db().recordings.delete(id);
    return fail(`The recording couldn't start (${(e as Error).message}).`);
  }

  const progress = setInterval(() => {
    void updateRecording(id, { durationMs: Date.now() - startedAt, bytes: sink.bytes() });
    void freeSpace().then((left) => {
      if (left === null || !active) return;
      if (left < AUTO_STOP_BELOW) return stopOnFailure("Storage is nearly full, so the recording was stopped and saved.");
      const elapsedS = (Date.now() - startedAt) / 1000;
      const minutesLeft = elapsedS > 10 ? left / (sink.bytes() / elapsedS) / 60 : Infinity;
      if (minutesLeft < WARN_MINUTES_LEFT) store().set({ warning: `Storage is running out: about ${Math.ceil(minutesLeft)} min left.` });
    });
  }, PROGRESS_SAVE_MS);

  active = { row, sink, capture, startedAt, progress, releaseLock: holdLock(id), stopping: null, failure: null };
  store().set({ status: "recording", startedAt, warning });
}

/**
 * Ends the recording and finalises the file. The capture stops before this
 * first awaits, so a caller about to release the devices can't record their
 * disappearance. `quiet` keeps a stop from opening the review dialog.
 */
export function stopRecording({ quiet }: { quiet: boolean }): Promise<void> {
  if (store().status === "preparing") {
    startOp++;
    store().set({ status: "idle" });
    return Promise.resolve();
  }
  const a = active;
  if (!a) return Promise.resolve();
  if (a.stopping) return a.stopping;

  const durationMs = Date.now() - a.startedAt;
  clearInterval(a.progress);
  store().set({ status: "stopping" });
  const captured = a.capture.stop();

  a.stopping = (async () => {
    await captured;
    let failure = a.failure;
    let bytes = a.sink.bytes();
    try {
      bytes = await a.sink.close();
    } catch (e) {
      failure ??= `Saving failed (${(e as Error).message}).`;
    }
    // Only now is the file whole, so only now may it be called complete.
    const status = failure ? "interrupted" : "complete";
    const done: RecordingRecord = { ...a.row, durationMs, bytes, status };
    await updateRecording(a.row.id, { durationMs, bytes, status });
    a.releaseLock();
    active = null;
    store().set({ status: "idle", error: failure, warning: null, lastOutcome: failure ? "failed" : "saved", finished: quiet ? null : done });
  })();
  return a.stopping;
}

/** Emergency Stop keeps what was recorded, without a dialog in the middle of a panic. */
registerStopper(() => stopRecording({ quiet: true }));

/**
 * At startup: a row still marked as recording whose lock is free belonged to a
 * tab that died. A held lock means a recording is really running elsewhere (or
 * that tab is frozen), so it's left alone. Files with no row are leftovers.
 */
export async function recoverInterruptedRecordings(): Promise<void> {
  const rows = await db().recordings.toArray();
  for (const r of rows.filter((x) => x.status === "recording")) {
    const reclaim = async () => {
      const file = await readRecordingFile(r.opfsPath);
      await updateRecording(r.id, { status: "interrupted", bytes: file?.size ?? r.bytes });
    };
    if (navigator.locks) await navigator.locks.request(lockName(r.id), { ifAvailable: true }, (lock) => (lock ? reclaim() : undefined));
    else await reclaim();
  }
  const known = new Set(rows.map((r) => r.opfsPath));
  for (const name of await listRecordingFiles()) if (!known.has(name)) await deleteRecordingFile(name).catch(() => undefined);
}

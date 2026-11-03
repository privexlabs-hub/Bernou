/**
 * Emergency Stop: one action that ends every capture.
 *   1. blank the audience window (neutral frame, camera released there)
 *   2. stop every MediaStreamTrack the presenter window owns
 *   3. close the audio graph
 *   4. stop any recorder, keeping what it recorded
 *
 * Driven by a global shortcut (Ctrl/Cmd+Shift+Escape) and a toolbar button.
 * It does not close the audience window — a sudden window disappearance in a
 * meeting is more alarming than a neutral frame — but it resumes nothing until
 * the presenter explicitly turns things back on.
 */
import { useDevicesStore } from "@/stores/private/devicesStore";
import { useRecordingStore } from "@/stores/private/recordingStore";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { getAudiencePublisher } from "@/features/audienceWindow/AudienceWindowControls";

export interface StopReport {
  at: number;
  tracksStopped: number;
  requestsCancelled: number;
  audienceBlanked: boolean;
  /** "saving" if the file wasn't finalised by the time this was reported. */
  recording: "none" | "saved" | "saving" | "failed";
}

/** Registry of stoppers added by later stages (e.g. the recorder). */
const extraStoppers = new Set<() => Promise<void> | void>();
export function registerStopper(fn: () => Promise<void> | void): () => void {
  extraStoppers.add(fn);
  return () => extraStoppers.delete(fn);
}

/** How long the report waits for stoppers. They keep running after this. */
const STOPPER_REPORT_WAIT_MS = 5000;

let lastReport: StopReport | null = null;
export function getLastStopReport() {
  return lastReport;
}

export async function emergencyStop(): Promise<StopReport> {
  const pub = getAudiencePublisher();
  const audienceBlanked = !!pub;
  pub?.blank();
  const wasRecording = useRecordingStore.getState().status !== "idle";

  // Stoppers start before devices are released so a recording can't capture
  // the moment the camera disappears. One that fails or hangs must not get in
  // the way of ending capture, so nothing here waits on them until the end.
  const stopping: Promise<void>[] = [];
  for (const s of extraStoppers) {
    try {
      stopping.push(Promise.resolve(s()));
    } catch {
      /* the remaining steps still have to run */
    }
  }
  const released = useDevicesStore.getState().releaseAll();
  useTeleprompterStore.getState().stop();

  const { tracksStopped, requestsCancelled } = await released;
  await Promise.race([Promise.allSettled(stopping), new Promise((r) => setTimeout(r, STOPPER_REPORT_WAIT_MS))]);

  const rec = useRecordingStore.getState();
  const recording = !wasRecording ? "none" : rec.status !== "idle" ? "saving" : (rec.lastOutcome ?? "failed");
  lastReport = { at: Date.now(), tracksStopped, requestsCancelled, audienceBlanked, recording };
  return lastReport;
}

/** After an emergency stop, let the audience window show the composition again. */
export function resumeAudience() {
  getAudiencePublisher()?.resume();
}

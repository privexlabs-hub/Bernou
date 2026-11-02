/**
 * Emergency Stop: one action that ends every capture.
 *   1. blank the audience window (neutral frame, camera released there)
 *   2. stop every MediaStreamTrack the presenter window owns
 *   3. close the audio graph
 *   4. (stage THIRD) stop any recorder
 *
 * Driven by a global shortcut (Ctrl/Cmd+Shift+Escape) and a toolbar button.
 * It does not close the audience window — a sudden window disappearance in a
 * meeting is more alarming than a neutral frame — but it resumes nothing until
 * the presenter explicitly turns things back on.
 */
import { useDevicesStore } from "@/stores/private/devicesStore";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { getAudiencePublisher } from "@/features/audienceWindow/AudienceWindowControls";

export interface StopReport {
  at: number;
  tracksEnded: number;
  audienceBlanked: boolean;
}

/** Registry of stoppers added by later stages (e.g. the recorder). */
const extraStoppers = new Set<() => Promise<void> | void>();
export function registerStopper(fn: () => Promise<void> | void): () => void {
  extraStoppers.add(fn);
  return () => extraStoppers.delete(fn);
}

let lastReport: StopReport | null = null;
export function getLastStopReport() {
  return lastReport;
}

export async function emergencyStop(): Promise<StopReport> {
  const pub = getAudiencePublisher();
  const audienceBlanked = !!pub;
  pub?.blank();

  const d = useDevicesStore.getState();
  const tracks = [...(d.cameraStream?.getTracks() ?? []), ...(d.micStream?.getTracks() ?? [])];
  await d.releaseAll();
  useTeleprompterStore.getState().stop();
  for (const s of extraStoppers) await s();

  lastReport = { at: Date.now(), tracksEnded: tracks.filter((t) => t.readyState === "ended").length, audienceBlanked };
  return lastReport;
}

/** After an emergency stop, let the audience window show the composition again. */
export function resumeAudience() {
  getAudiencePublisher()?.resume();
}

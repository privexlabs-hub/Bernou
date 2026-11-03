/** Turns a finished recording into a file the presenter can keep. */
import { patchWebmDuration, readRecordingFile } from "@bernou/media-core/recorder";
import type { RecordingRecord } from "@/db/dexie";
import { updateRecording } from "@/db/repositories/recordings";

/** Far more than a WebM's header ever needs. */
const WEBM_HEAD_BYTES = 64 * 1024;

export function recordingFileName(title: string, createdAt: number, extension: string): string {
  const safe = title.replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").replace(/^[ .]+|[ .]+$/g, "").slice(0, 80) || "Recording";
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${safe}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${extension}`;
}

export async function recordingBlob(rec: RecordingRecord): Promise<Blob | null> {
  const file = await readRecordingFile(rec.opfsPath);
  if (!file) return null;
  if (rec.extension !== "webm" || rec.durationMs <= 0) return new Blob([file], { type: rec.mime });
  const head = new Uint8Array(await file.slice(0, WEBM_HEAD_BYTES).arrayBuffer());
  const patch = patchWebmDuration(head, rec.durationMs);
  if (!patch) return new Blob([file], { type: rec.mime });
  return new Blob([patch.bytes as BlobPart, file.slice(patch.consumed)], { type: rec.mime });
}

/** Returns false if the file is gone. "Saved" here means the download was handed to the browser. */
export async function downloadRecording(rec: RecordingRecord): Promise<boolean> {
  const blob = await recordingBlob(rec);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = recordingFileName(rec.title, rec.createdAt, rec.extension);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  await updateRecording(rec.id, { savedToDisk: true });
  return true;
}

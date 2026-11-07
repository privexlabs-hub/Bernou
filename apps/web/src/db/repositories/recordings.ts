import { deleteRecordingFile } from "@bernou/media-core/recorder";
import { db, type RecordingRecord } from "../dexie";

export async function listRecordingsRecent(limit = 20): Promise<RecordingRecord[]> {
  return db().recordings.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function addRecording(rec: RecordingRecord): Promise<void> {
  await db().recordings.add(rec);
}

export async function updateRecording(id: string, patch: Partial<RecordingRecord>): Promise<void> {
  await db().recordings.update(id, patch);
}

/**
 * The file goes first: a row with no file can be retried, a file with no row is
 * invisible. Its edits go with it. Recordings exported from it are whole files
 * of their own, and stay.
 */
export async function deleteRecording(rec: Pick<RecordingRecord, "id" | "opfsPath">): Promise<void> {
  await deleteRecordingFile(rec.opfsPath);
  await db().transaction("rw", db().recordings, db().editProjects, async () => {
    await db().recordings.delete(rec.id);
    await db().editProjects.delete(rec.id);
  });
}

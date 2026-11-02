import { db, type RecordingRecord } from "../dexie";

export async function listRecordingsRecent(limit = 20): Promise<RecordingRecord[]> {
  return db().recordings.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function addRecording(rec: RecordingRecord): Promise<void> {
  await db().recordings.add(rec);
}

export async function deleteRecording(id: string): Promise<void> {
  await db().recordings.delete(id);
}

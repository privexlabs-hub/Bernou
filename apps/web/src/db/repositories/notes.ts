/** PRIVATE repository: speaker notes. Never imported by audience code. */
import { db, type NoteRecord } from "../dexie";

export async function getNotes(sessionId: string): Promise<NoteRecord[]> {
  return db().notes.where("sessionId").equals(sessionId).toArray();
}

export async function saveNote(sessionId: string, slideIndex: number, body: string): Promise<void> {
  await db().notes.put({ id: `${sessionId}:${slideIndex}`, sessionId, slideIndex, body, updatedAt: Date.now() });
}

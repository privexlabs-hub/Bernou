import { db, DEFAULT_COMPOSITION, DEFAULT_TELEPROMPTER, type SessionRecord } from "../dexie";
import { newId } from "@/lib/id";

export async function createSession(title = "Untitled presentation"): Promise<SessionRecord> {
  const now = Date.now();
  const rec: SessionRecord = {
    id: newId(),
    title,
    createdAt: now,
    updatedAt: now,
    sourceFileName: null,
    sourceKind: "none",
    slideCount: 0,
    composition: structuredClone(DEFAULT_COMPOSITION),
    teleprompter: structuredClone(DEFAULT_TELEPROMPTER),
    activeSlideIndex: 0,
  };
  await db().sessions.add(rec);
  return rec;
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return db().sessions.get(id);
}

export async function listSessionsRecent(limit = 50): Promise<SessionRecord[]> {
  return db().sessions.orderBy("updatedAt").reverse().limit(limit).toArray();
}

export async function updateSession(id: string, patch: Partial<Omit<SessionRecord, "id" | "createdAt">>): Promise<void> {
  await db().sessions.update(id, { ...patch, updatedAt: Date.now() });
}

export async function renameSession(id: string, title: string): Promise<void> {
  await updateSession(id, { title: title.trim() || "Untitled presentation" });
}

/** Deletes the session and everything that belongs to it. */
export async function deleteSession(id: string): Promise<void> {
  const d = db();
  await d.transaction("rw", d.sessions, d.slides, d.scripts, d.notes, async () => {
    await d.slides.where("sessionId").equals(id).delete();
    await d.notes.where("sessionId").equals(id).delete();
    await d.scripts.delete(id);
    await d.sessions.delete(id);
  });
}

export async function duplicateSession(id: string): Promise<SessionRecord | undefined> {
  const d = db();
  const src = await d.sessions.get(id);
  if (!src) return undefined;
  const now = Date.now();
  const copy: SessionRecord = { ...structuredClone(src), id: newId(), title: `${src.title} (copy)`, createdAt: now, updatedAt: now };
  await d.transaction("rw", d.sessions, d.slides, d.scripts, d.notes, async () => {
    await d.sessions.add(copy);
    const slides = await d.slides.where("sessionId").equals(id).toArray();
    await d.slides.bulkAdd(slides.map((s) => ({ ...s, id: `${copy.id}:${s.index}`, sessionId: copy.id })));
    const script = await d.scripts.get(id);
    if (script) await d.scripts.add({ ...script, sessionId: copy.id });
    const notes = await d.notes.where("sessionId").equals(id).toArray();
    await d.notes.bulkAdd(notes.map((n) => ({ ...n, id: `${copy.id}:${n.slideIndex}`, sessionId: copy.id })));
  });
  return copy;
}

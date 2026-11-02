/** PRIVATE repository: speech scripts. Never imported by audience code. */
import { db, type ScriptRecord } from "../dexie";

export async function getScript(sessionId: string): Promise<ScriptRecord | undefined> {
  return db().scripts.get(sessionId);
}

export async function saveScript(sessionId: string, sections: ScriptRecord["sections"]): Promise<void> {
  await db().scripts.put({ sessionId, sections, updatedAt: Date.now() });
}

export async function listScriptsRecent(limit = 20): Promise<ScriptRecord[]> {
  return db().scripts.orderBy("updatedAt").reverse().limit(limit).toArray();
}

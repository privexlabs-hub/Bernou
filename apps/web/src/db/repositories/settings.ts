import { db } from "../dexie";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db().settings.get(key);
  return r ? (r.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db().settings.put({ key, value });
}

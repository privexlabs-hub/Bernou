/** Repository: marks on slides, one row per slide. */
import { db } from "../dexie";
import type { InkStroke } from "@bernou/audience-protocol";

export async function getInk(sessionId: string): Promise<Record<number, InkStroke[]>> {
  const rows = await db().ink.where("sessionId").equals(sessionId).toArray();
  return Object.fromEntries(rows.map((r) => [r.slideIndex, r.strokes]));
}

export async function saveInk(sessionId: string, slideIndex: number, strokes: InkStroke[]): Promise<void> {
  const id = `${sessionId}:${slideIndex}`;
  if (strokes.length === 0) await db().ink.delete(id);
  else await db().ink.put({ id, sessionId, slideIndex, strokes, updatedAt: Date.now() });
}

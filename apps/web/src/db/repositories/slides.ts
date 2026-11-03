import { db, type SlideRecord } from "../dexie";

export async function getSlides(sessionId: string): Promise<SlideRecord[]> {
  return db().slides.where("[sessionId+index]").between([sessionId, -Infinity], [sessionId, Infinity]).toArray();
}

/** Returns the deck's new revision (see toDeckSlides). */
export async function replaceSlides(sessionId: string, slides: Omit<SlideRecord, "id" | "sessionId">[]): Promise<number> {
  const d = db();
  return d.transaction("rw", d.slides, d.sessions, d.ink, async () => {
    const deckRevision = ((await d.sessions.get(sessionId))?.deckRevision ?? 0) + 1;
    await d.slides.where("sessionId").equals(sessionId).delete();
    await d.ink.where("sessionId").equals(sessionId).delete(); // marks belong to the slides they were drawn on
    await d.slides.bulkAdd(slides.map((s) => ({ ...s, id: `${sessionId}:${s.index}`, sessionId })));
    await d.sessions.update(sessionId, { slideCount: slides.length, activeSlideIndex: 0, deckRevision, updatedAt: Date.now() });
    return deckRevision;
  });
}

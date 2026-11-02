import { db, type SlideRecord } from "../dexie";

export async function getSlides(sessionId: string): Promise<SlideRecord[]> {
  return db().slides.where("[sessionId+index]").between([sessionId, -Infinity], [sessionId, Infinity]).toArray();
}

export async function replaceSlides(sessionId: string, slides: Omit<SlideRecord, "id" | "sessionId">[]): Promise<void> {
  const d = db();
  await d.transaction("rw", d.slides, d.sessions, async () => {
    await d.slides.where("sessionId").equals(sessionId).delete();
    await d.slides.bulkAdd(slides.map((s) => ({ ...s, id: `${sessionId}:${s.index}`, sessionId })));
    await d.sessions.update(sessionId, { slideCount: slides.length, activeSlideIndex: 0, updatedAt: Date.now() });
  });
}

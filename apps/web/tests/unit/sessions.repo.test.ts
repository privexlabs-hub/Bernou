import { beforeEach, describe, expect, it } from "vitest";
import { BernouDB, __setDbForTests, db } from "@/db/dexie";
import { createSession, deleteSession, duplicateSession, getSession, listSessionsRecent, renameSession } from "@/db/repositories/sessions";
import { saveScript, getScript } from "@/db/repositories/scripts";
import { saveNote, getNotes } from "@/db/repositories/notes";
import { replaceSlides, getSlides } from "@/db/repositories/slides";

beforeEach(async () => {
  const fresh = new BernouDB(`test-${Math.random()}`);
  __setDbForTests(fresh);
  await fresh.open();
});

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

describe("sessions repository", () => {
  it("creates a session with defaults and lists it most-recent-first", async () => {
    const a = await createSession("A");
    await new Promise((r) => setTimeout(r, 2));
    const b = await createSession("B");
    const list = await listSessionsRecent();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(a.composition.camera.shape).toBe("circle");
    expect(a.slideCount).toBe(0);
  });

  it("renames and trims; empty title falls back", async () => {
    const s = await createSession("X");
    await renameSession(s.id, "  Lecture 3  ");
    expect((await getSession(s.id))?.title).toBe("Lecture 3");
    await renameSession(s.id, "   ");
    expect((await getSession(s.id))?.title).toBe("Untitled presentation");
  });

  it("deletes a session together with its slides, script and notes", async () => {
    const s = await createSession("D");
    await replaceSlides(s.id, [{ index: 0, width: 10, height: 10, mime: "image/png", blob: png(), thumb: png(), thumbWidth: 2, thumbHeight: 2 }]);
    await saveScript(s.id, [{ id: "s1", title: "Intro", body: "Hello", slideIndex: 0 }]);
    await saveNote(s.id, 0, "note");
    await deleteSession(s.id);
    expect(await getSession(s.id)).toBeUndefined();
    expect(await getSlides(s.id)).toHaveLength(0);
    expect(await getScript(s.id)).toBeUndefined();
    expect(await getNotes(s.id)).toHaveLength(0);
  });

  it("duplicates a session with slides, script and notes under new ids", async () => {
    const s = await createSession("Orig");
    await replaceSlides(s.id, [
      { index: 0, width: 10, height: 10, mime: "image/png", blob: png(), thumb: png(), thumbWidth: 2, thumbHeight: 2 },
      { index: 1, width: 10, height: 10, mime: "image/png", blob: png(), thumb: png(), thumbWidth: 2, thumbHeight: 2 },
    ]);
    await saveScript(s.id, [{ id: "s1", title: "Intro", body: "Hello", slideIndex: 0 }]);
    await saveNote(s.id, 1, "second");
    const copy = await duplicateSession(s.id);
    expect(copy).toBeDefined();
    expect(copy!.title).toBe("Orig (copy)");
    expect(await getSlides(copy!.id)).toHaveLength(2);
    expect((await getScript(copy!.id))?.sections[0]?.body).toBe("Hello");
    expect((await getNotes(copy!.id))[0]?.body).toBe("second");
    // original untouched
    expect(await getSlides(s.id)).toHaveLength(2);
    expect(await db().sessions.count()).toBe(2);
  });

  it("replaceSlides updates slideCount and resets the active slide", async () => {
    const s = await createSession("R");
    await db().sessions.update(s.id, { activeSlideIndex: 5 });
    await replaceSlides(s.id, [{ index: 0, width: 10, height: 10, mime: "image/png", blob: png(), thumb: png(), thumbWidth: 2, thumbHeight: 2 }]);
    const after = await getSession(s.id);
    expect(after?.slideCount).toBe(1);
    expect(after?.activeSlideIndex).toBe(0);
  });
});

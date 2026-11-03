import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { BernouDB, __setDbForTests } from "@/db/dexie";
import { getInk, saveInk } from "@/db/repositories/ink";
import { replaceSlides } from "@/db/repositories/slides";
import { deleteSession, duplicateSession } from "@/db/repositories/sessions";

const NAME = "upgrade-test";

/** A database exactly as version 1 of the app created it, with data in it. */
async function createV1(name: string) {
  const v1 = new Dexie(name);
  v1.version(1).stores({
    sessions: "id, updatedAt, createdAt",
    slides: "id, sessionId, [sessionId+index]",
    scripts: "sessionId, updatedAt",
    notes: "id, sessionId, [sessionId+slideIndex]",
    recordings: "id, sessionId, createdAt",
    settings: "key",
  });
  await v1.open();
  await v1.table("sessions").add({ id: "s1", title: "Old talk", createdAt: 1, updatedAt: 1, slideCount: 1, activeSlideIndex: 0 });
  await v1.table("slides").add({ id: "s1:0", sessionId: "s1", index: 0, width: 10, height: 10 });
  await v1.table("scripts").add({ sessionId: "s1", sections: [{ id: "a", title: "", body: "Hello", slideIndex: null }], updatedAt: 1 });
  await v1.table("notes").add({ id: "s1:0", sessionId: "s1", slideIndex: 0, body: "A note", updatedAt: 1 });
  await v1.table("recordings").add({ id: "r1", sessionId: "s1", title: "Old talk", createdAt: 1 });
  await v1.table("settings").add({ key: "app", value: { defaultProfile: "720p" } });
  v1.close();
}

describe("upgrading an existing database", () => {
  it("keeps everything and adds the ink table", async () => {
    await createV1(NAME);
    const db = new BernouDB(NAME);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.sessions.get("s1")).toMatchObject({ title: "Old talk" });
    expect(await db.slides.count()).toBe(1);
    expect((await db.scripts.get("s1"))?.sections[0]?.body).toBe("Hello");
    expect((await db.notes.get("s1:0"))?.body).toBe("A note");
    expect(await db.recordings.count()).toBe(1);
    expect(await db.settings.get("app")).toBeTruthy();
    expect(await db.ink.count()).toBe(0);
    db.close();
    await Dexie.delete(NAME);
  });
});

describe("ink repository", () => {
  const stroke = { tool: "pen" as const, color: "#ef4444" as const, points: [1, 2, 3, 4] };

  async function fresh() {
    const db = new BernouDB(`ink-${Math.random()}`);
    __setDbForTests(db);
    await db.open();
    await db.sessions.add({ id: "s1", title: "T", createdAt: 1, updatedAt: 1, slideCount: 2, activeSlideIndex: 0 } as never);
    return db;
  }

  it("saves per slide, and saving nothing removes the row", async () => {
    await fresh();
    await saveInk("s1", 0, [stroke]);
    await saveInk("s1", 3, [stroke, stroke]);
    expect(Object.keys(await getInk("s1"))).toEqual(["0", "3"]);
    await saveInk("s1", 0, []);
    expect(Object.keys(await getInk("s1"))).toEqual(["3"]);
  });
  it("replacing the slides clears their marks", async () => {
    await fresh();
    await saveInk("s1", 0, [stroke]);
    await replaceSlides("s1", []);
    expect(await getInk("s1")).toEqual({});
  });
  it("deleting removes them, and duplicating copies them", async () => {
    const db = await fresh();
    await saveInk("s1", 1, [stroke]);
    const copy = await duplicateSession("s1");
    expect(await getInk(copy!.id)).toEqual({ 1: [stroke] });
    await deleteSession("s1");
    expect(await getInk("s1")).toEqual({});
    expect(await db.ink.where("sessionId").equals(copy!.id).count()).toBe(1);
  });
});

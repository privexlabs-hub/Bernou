import Dexie from "dexie";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@bernou/media-core/recorder", async (orig) => ({ ...(await orig<typeof import("@bernou/media-core/recorder")>()), deleteRecordingFile: vi.fn(async () => undefined) }));

import { BernouDB, __setDbForTests } from "@/db/dexie";
import { deleteRecording } from "@/db/repositories/recordings";
import { getEditProject, saveEditProject } from "@/db/repositories/editProjects";
import { newEditProject, OVERLAY_TEXT_MAX } from "@/features/editor/project";
import { useEditorStore } from "@/stores/private/editorStore";

const rec = { id: "r1", sessionId: null, title: "Talk", createdAt: 1, durationMs: 10_000, mime: "video/mp4", extension: "mp4", bytes: 1, width: 1920, height: 1080, opfsPath: "r1.mp4", savedToDisk: false };

describe("database version 3", () => {
  it("upgrades a version 2 database holding data, keeping all of it", async () => {
    const name = `v2-${Math.random()}`;
    const v2 = new Dexie(name);
    v2.version(2).stores({
      sessions: "id, updatedAt, createdAt",
      slides: "id, sessionId, [sessionId+index]",
      scripts: "sessionId, updatedAt",
      notes: "id, sessionId, [sessionId+slideIndex]",
      recordings: "id, sessionId, createdAt",
      settings: "key",
      ink: "id, sessionId, [sessionId+slideIndex]",
    });
    await v2.open();
    await v2.table("sessions").add({ id: "s1", title: "Old talk", createdAt: 1, updatedAt: 1 });
    await v2.table("recordings").add(rec);
    await v2.table("ink").add({ id: "s1:0", sessionId: "s1", slideIndex: 0, strokes: [] });
    v2.close();

    const db = new BernouDB(name);
    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.sessions.get("s1")).toMatchObject({ title: "Old talk" });
    expect(await db.recordings.get("r1")).toMatchObject({ title: "Talk" });
    expect((await db.recordings.get("r1"))?.editedFrom).toBeUndefined(); // an original
    expect(await db.ink.count()).toBe(1);
    expect(await db.editProjects.count()).toBe(0);
    db.close();
    await Dexie.delete(name);
  });
});

describe("edit projects", () => {
  beforeEach(async () => {
    const db = new BernouDB(`ed-${Math.random()}`);
    __setDbForTests(db);
    await db.open();
    await db.recordings.add(rec);
  });

  it("a new project keeps the whole recording, with neutral settings", () => {
    const p = newEditProject(rec);
    expect(p).toMatchObject({ id: "r1", trim: { start: 0, end: 10 }, cuts: [], smoothJoins: false, overlays: [] });
    expect(p.audio).toEqual({ volumeDb: 0, mutes: [], denoise: { on: false, strength: 1 } });
    expect(p.picture).toEqual({ brightness: 0, contrast: 0, saturation: 0 });
  });

  it("saves and reads back", async () => {
    const p = { ...newEditProject(rec), cuts: [{ start: 2, end: 4 }] };
    await saveEditProject(p);
    expect((await getEditProject("r1"))?.cuts).toEqual([{ start: 2, end: 4 }]);
  });

  it("deleting the recording deletes its project", async () => {
    await saveEditProject(newEditProject(rec));
    await deleteRecording(rec);
    expect(await getEditProject("r1")).toBeUndefined();
  });

  it("overlay text is capped", () => {
    expect(OVERLAY_TEXT_MAX).toBe(200);
  });
});

describe("editor store: undo and redo", () => {
  beforeEach(() => useEditorStore.getState().load(newEditProject(rec)));
  const s = () => useEditorStore.getState();

  it("each change can be undone and redone, in order", () => {
    s().change((p) => ({ ...p, cuts: [{ start: 1, end: 2 }] }));
    s().change((p) => ({ ...p, smoothJoins: true }));
    expect(s().project!.smoothJoins).toBe(true);
    s().undo();
    expect(s().project!.smoothJoins).toBe(false);
    expect(s().project!.cuts).toHaveLength(1);
    s().undo();
    expect(s().project!.cuts).toHaveLength(0);
    expect(s().canUndo()).toBe(false);
    s().redo();
    s().redo();
    expect(s().project!.smoothJoins).toBe(true);
    expect(s().canRedo()).toBe(false);
  });

  it("a new change after undo drops the redo history", () => {
    s().change((p) => ({ ...p, smoothJoins: true }));
    s().undo();
    s().change((p) => ({ ...p, picture: { ...p.picture, brightness: 10 } }));
    expect(s().canRedo()).toBe(false);
  });

  it("a change that changes nothing isn't a step", () => {
    s().change((p) => p);
    expect(s().canUndo()).toBe(false);
  });

  it("history is bounded", () => {
    for (let i = 0; i < 250; i++) s().change((p) => ({ ...p, picture: { ...p.picture, brightness: i % 50 } }));
    let steps = 0;
    while (s().canUndo()) {
      s().undo();
      steps++;
    }
    expect(steps).toBe(100);
  });

  it("loading another project clears the history", () => {
    s().change((p) => ({ ...p, smoothJoins: true }));
    s().load(newEditProject({ ...rec, id: "r2" }));
    expect(s().canUndo()).toBe(false);
  });
});

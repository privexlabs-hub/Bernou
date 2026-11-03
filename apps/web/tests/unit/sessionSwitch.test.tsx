import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { BernouDB, __setDbForTests } from "@/db/dexie";
import { createSession } from "@/db/repositories/sessions";
import { getScript, saveScript } from "@/db/repositories/scripts";
import { getNotes } from "@/db/repositories/notes";
import { useSessionLoader } from "@/features/session/useSessionLoader";
import { useScriptAutosave } from "@/features/script/ScriptEditor";
import { NotesPanel } from "@/features/notes/NotesPanel";
import { useDeckStore } from "@/stores/public/deckStore";
import { useNotesStore } from "@/stores/private/notesStore";
import { useScriptStore } from "@/stores/private/scriptStore";

beforeEach(async () => {
  const fresh = new BernouDB(`test-${Math.random()}`);
  __setDbForTests(fresh);
  await fresh.open();
  useScriptStore.getState().setSession(null, []);
  useNotesStore.getState().setSession(null, []);
});

const section = (body: string) => [{ id: body, title: "", body, slideIndex: null }];

/** The real order: Studio's loader is the parent, so its cleanup runs before the autosave's. */
const studioHooks = (id: string) =>
  renderHook(() => {
    useSessionLoader(id);
    useScriptAutosave();
  });

describe("leaving a session", () => {
  it("clears the private stores, so nothing from it can show in the next session", async () => {
    const a = await createSession("A");
    await saveScript(a.id, section("A's secret"));
    const { unmount } = studioHooks(a.id);
    await waitFor(() => expect(useScriptStore.getState().sessionId).toBe(a.id));

    unmount();
    expect(useScriptStore.getState().sections).toEqual([]);
    expect(useScriptStore.getState().sessionId).toBeNull();
    expect(useNotesStore.getState().sessionId).toBeNull();
    expect(useNotesStore.getState().bySlide).toEqual({});
  });

  it("still saves an edit made just before leaving, to the session it belongs to", async () => {
    const a = await createSession("A");
    const b = await createSession("B");
    const { unmount } = studioHooks(a.id);
    await waitFor(() => expect(useScriptStore.getState().sessionId).toBe(a.id));

    act(() => useScriptStore.getState().replaceWithText("edited in A"));
    unmount(); // inside the autosave debounce
    const next = studioHooks(b.id);
    await waitFor(() => expect(useScriptStore.getState().sessionId).toBe(b.id));

    await waitFor(async () => expect((await getScript(a.id))?.sections[0]?.body).toBe("edited in A"));
    expect(await getScript(b.id)).toBeUndefined();
    next.unmount();
  });
});

describe("notes autosave", () => {
  const typeNote = (el: Element, value: string) => fireEvent.change(el, { target: { value } });

  beforeEach(() => {
    useDeckStore.setState({ slides: [], activeIndex: 0 });
    useNotesStore.getState().setSession("s1", []);
  });

  it("saves a note typed just before the panel closes", async () => {
    const { getByTestId, unmount } = render(<NotesPanel />);
    typeNote(getByTestId("notes-body"), "last thought");
    unmount();
    await waitFor(async () => expect((await getNotes("s1")).map((n) => n.body)).toEqual(["last thought"]));
  });

  it("keeps the previous slide's note when typing continues on another slide", async () => {
    const { getByTestId, unmount } = render(<NotesPanel />);
    typeNote(getByTestId("notes-body"), "note for slide 0");
    act(() => useDeckStore.setState({ activeIndex: 1 }));
    typeNote(getByTestId("notes-body"), "note for slide 1");
    await waitFor(async () => {
      const notes = await getNotes("s1");
      expect(Object.fromEntries(notes.map((n) => [n.slideIndex, n.body]))).toEqual({ 0: "note for slide 0", 1: "note for slide 1" });
    });
    unmount();
  });
});

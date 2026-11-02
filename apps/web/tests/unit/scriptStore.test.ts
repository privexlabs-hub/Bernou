import { beforeEach, describe, expect, it } from "vitest";
import { selectFullText, selectSectionsForSlide, selectWordCount, useScriptStore } from "@/stores/private/scriptStore";

beforeEach(() => useScriptStore.getState().setSession("s", []));

describe("scriptStore", () => {
  it("replaceWithText creates one section and marks dirty", () => {
    useScriptStore.getState().replaceWithText("Hello world\n\nSecond para");
    const s = useScriptStore.getState();
    expect(s.sections).toHaveLength(1);
    expect(s.dirty).toBe(true);
    expect(selectWordCount(s)).toBe(4);
  });

  it("splitSection splits at blank lines keeping the first id/title/link", () => {
    useScriptStore.getState().replaceWithText("A one\n\nB two\n\n\nC three");
    const id = useScriptStore.getState().sections[0]!.id;
    useScriptStore.getState().updateSection(id, { title: "Intro", slideIndex: 2 });
    useScriptStore.getState().splitSection(id);
    const s = useScriptStore.getState().sections;
    expect(s.map((x) => x.body)).toEqual(["A one", "B two", "C three"]);
    expect(s[0]!.id).toBe(id);
    expect(s[0]!.title).toBe("Intro");
    expect(s[0]!.slideIndex).toBe(2);
    expect(s[1]!.slideIndex).toBeNull();
  });

  it("add/move/remove keep order and active section sane", () => {
    const st = useScriptStore.getState;
    const a = st().addSection(null, { body: "a" });
    const b = st().addSection(a, { body: "b" });
    const c = st().addSection(b, { body: "c" });
    expect(st().sections.map((s) => s.body)).toEqual(["a", "b", "c"]);
    st().moveSection(c, -1);
    expect(st().sections.map((s) => s.body)).toEqual(["a", "c", "b"]);
    st().moveSection(a, -1); // no-op at top
    expect(st().sections[0]!.body).toBe("a");
    st().setActiveSection(c);
    st().removeSection(c);
    expect(st().sections.map((s) => s.body)).toEqual(["a", "b"]);
    expect(st().activeSectionId).toBe(a);
  });

  it("selectors: full text in order, sections per slide", () => {
    const st = useScriptStore.getState;
    const a = st().addSection(null, { title: "T", body: "one", slideIndex: 0 });
    st().addSection(a, { body: "two", slideIndex: 1 });
    st().addSection(null, { body: "three", slideIndex: 0 });
    expect(selectFullText(st())).toBe("T\n\none\n\ntwo\n\nthree");
    expect(selectSectionsForSlide(st(), 0).map((s) => s.body)).toEqual(["one", "three"]);
  });
});

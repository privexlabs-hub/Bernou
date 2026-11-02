/**
 * PRIVATE store: the presenter's speech script, organised into sections that
 * may be linked to slides. Nothing in this file may ever be imported by
 * audience code (enforced by .dependency-cruiser.cjs).
 */
import { create } from "zustand";
import { newId } from "@/lib/id";

export interface ScriptSection {
  id: string;
  title: string;
  body: string;
  /** Slide index this section is associated with, or null for "unlinked". */
  slideIndex: number | null;
}

interface ScriptState {
  sessionId: string | null;
  sections: ScriptSection[];
  /** Section currently being edited / read. */
  activeSectionId: string | null;
  dirty: boolean;
  setSession: (sessionId: string | null, sections: ScriptSection[]) => void;
  addSection: (after?: string | null, init?: Partial<ScriptSection>) => string;
  updateSection: (id: string, patch: Partial<Omit<ScriptSection, "id">>) => void;
  removeSection: (id: string) => void;
  moveSection: (id: string, dir: -1 | 1) => void;
  setActiveSection: (id: string | null) => void;
  /** Replace everything with one section from a pasted speech. */
  replaceWithText: (text: string) => void;
  /** Split a section at double newlines into several sections. */
  splitSection: (id: string) => void;
  markSaved: () => void;
}

export const useScriptStore = create<ScriptState>((set, get) => ({
  sessionId: null,
  sections: [],
  activeSectionId: null,
  dirty: false,

  setSession: (sessionId, sections) => set({ sessionId, sections, activeSectionId: sections[0]?.id ?? null, dirty: false }),

  addSection: (after = null, init = {}) => {
    const id = newId();
    const sec: ScriptSection = { id, title: "", body: "", slideIndex: null, ...init };
    const list = [...get().sections];
    const i = after ? list.findIndex((s) => s.id === after) : -1;
    list.splice(i >= 0 ? i + 1 : list.length, 0, sec);
    set({ sections: list, activeSectionId: id, dirty: true });
    return id;
  },

  updateSection: (id, patch) => set({ sections: get().sections.map((s) => (s.id === id ? { ...s, ...patch } : s)), dirty: true }),

  removeSection: (id) => {
    const list = get().sections.filter((s) => s.id !== id);
    const active = get().activeSectionId === id ? (list[0]?.id ?? null) : get().activeSectionId;
    set({ sections: list, activeSectionId: active, dirty: true });
  },

  moveSection: (id, dir) => {
    const list = [...get().sections];
    const i = list.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    set({ sections: list, dirty: true });
  },

  setActiveSection: (id) => set({ activeSectionId: id }),

  replaceWithText: (text) => {
    const id = newId();
    set({ sections: [{ id, title: "", body: text, slideIndex: null }], activeSectionId: id, dirty: true });
  },

  splitSection: (id) => {
    const list = [...get().sections];
    const i = list.findIndex((s) => s.id === id);
    const src = list[i];
    if (!src) return;
    const parts = src.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const replacement = parts.map((body, k) => ({ id: k === 0 ? src.id : newId(), title: k === 0 ? src.title : "", body, slideIndex: k === 0 ? src.slideIndex : null }));
    list.splice(i, 1, ...replacement);
    set({ sections: list, dirty: true });
  },

  markSaved: () => set({ dirty: false }),
}));

/** Concatenated script text in reading order (for the teleprompter). */
export function selectFullText(s: Pick<ScriptState, "sections">): string {
  return s.sections.map((sec) => (sec.title ? `${sec.title}\n\n${sec.body}` : sec.body)).join("\n\n");
}

export function selectWordCount(s: Pick<ScriptState, "sections">): number {
  return s.sections.reduce((n, sec) => n + sec.body.split(/\s+/).filter(Boolean).length, 0);
}

/** Sections linked to a given slide. */
export function selectSectionsForSlide(s: Pick<ScriptState, "sections">, slideIndex: number): ScriptSection[] {
  return s.sections.filter((sec) => sec.slideIndex === slideIndex);
}

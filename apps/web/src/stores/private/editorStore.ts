/**
 * PRIVATE store: the edit project open in the editor, with undo and redo.
 * Every change goes through `change`, so every change can be undone.
 */
import { create } from "zustand";
import type { EditProject } from "@/db/dexie";

const HISTORY = 100;

interface EditorState {
  project: EditProject | null;
  past: EditProject[];
  future: EditProject[];
  /** The control behind the last change, so a drag or typing is one undo step. */
  lastKey: string | null;
  load: (p: EditProject) => void;
  close: () => void;
  /** One undoable step. Consecutive changes with the same `key` (one slider, one text box) merge into one. */
  change: (fn: (p: EditProject) => EditProject, key?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  lastKey: null,
  load: (project) => set({ project, past: [], future: [], lastKey: null }),
  close: () => set({ project: null, past: [], future: [], lastKey: null }),
  change: (fn, key) => {
    const { project, past, lastKey } = get();
    if (!project) return;
    const next = fn(project);
    if (next === project || JSON.stringify(next) === JSON.stringify(project)) return;
    if (key && key === lastKey && past.length > 0) return set({ project: next, future: [] });
    set({ project: next, past: [...past, project].slice(-HISTORY), future: [], lastKey: key ?? null });
  },
  undo: () => {
    const { project, past, future } = get();
    const prev = past[past.length - 1];
    if (!project || !prev) return;
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], lastKey: null });
  },
  redo: () => {
    const { project, past, future } = get();
    const next = future[0];
    if (!project || !next) return;
    set({ project: next, past: [...past, project], future: future.slice(1), lastKey: null });
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

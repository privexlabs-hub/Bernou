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
  load: (p: EditProject) => void;
  close: () => void;
  change: (fn: (p: EditProject) => EditProject) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  load: (project) => set({ project, past: [], future: [] }),
  close: () => set({ project: null, past: [], future: [] }),
  change: (fn) => {
    const { project, past } = get();
    if (!project) return;
    const next = fn(project);
    if (next === project || JSON.stringify(next) === JSON.stringify(project)) return;
    set({ project: next, past: [...past, project].slice(-HISTORY), future: [] });
  },
  undo: () => {
    const { project, past, future } = get();
    const prev = past[past.length - 1];
    if (!project || !prev) return;
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
  },
  redo: () => {
    const { project, past, future } = get();
    const next = future[0];
    if (!project || !next) return;
    set({ project: next, past: [...past, project], future: future.slice(1) });
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

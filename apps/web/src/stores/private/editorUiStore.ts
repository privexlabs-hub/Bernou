/** PRIVATE store: the editor's selection and playhead. Not part of the project, so not undoable. */
import { create } from "zustand";
import type { TimeRange } from "@/db/dexie";

interface EditorUiState {
  /** A range picked on the timeline, in the original's time. */
  selection: TimeRange | null;
  selectedOverlay: string | null;
  /** The playhead, in the original's time and the output's. */
  sourceTime: number;
  outTime: number;
  playing: boolean;
  /** The side panel's tab. */
  panel: "cuts" | "audio" | "overlays" | "picture";
  set: (p: Partial<Omit<EditorUiState, "set" | "reset">>) => void;
  reset: () => void;
}

const initial = { selection: null, selectedOverlay: null, sourceTime: 0, outTime: 0, playing: false, panel: "cuts" as const };

export const useEditorUi = create<EditorUiState>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set(initial),
}));

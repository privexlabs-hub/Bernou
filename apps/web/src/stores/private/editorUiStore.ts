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
  panel: "cuts" | "silences" | "audio" | "overlays" | "picture";
  /** The timeline: the original (for cutting) or the edited result (for added audio), and each one's zoom. */
  mode: "original" | "edited";
  view: TimeRange | null;
  outView: TimeRange | null;
  /** Silences found, not yet removed, in the original's time. */
  silences: TimeRange[];
  /** The added track being edited. */
  selectedTrack: string | null;
  /** Silence finding settings: threshold (null: the suggested one), shortest gap, pause kept at each end. */
  silenceSettings: { thresholdDb: number | null; minDuration: number; keep: number };
  /** The gap under the pointer, by index in `silences`, or null. */
  hoverSilence: number | null;
  /** The Original timeline shows removed parts at full length, hatched, instead of closed up at a seam. */
  showRemoved: boolean;
  /** A short message about the last action, read out to screen readers. */
  status: string;
  set: (p: Partial<Omit<EditorUiState, "set" | "reset">>) => void;
  reset: () => void;
}

const initial = { selection: null, selectedOverlay: null, sourceTime: 0, outTime: 0, playing: false, panel: "cuts" as const, mode: "original" as const, view: null, outView: null, silences: [], selectedTrack: null, silenceSettings: { thresholdDb: null, minDuration: 0.5, keep: 0.15 }, hoverSilence: null, showRemoved: false, status: "" };

export const useEditorUi = create<EditorUiState>((set) => ({
  ...initial,
  set: (p) => set(p),
  reset: () => set(initial),
}));

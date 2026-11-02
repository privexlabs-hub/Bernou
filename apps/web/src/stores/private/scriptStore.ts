/**
 * PRIVATE store: the presenter's speech script.
 * Nothing in this file may ever be imported by audience code (enforced by
 * .dependency-cruiser.cjs). Full implementation lands in step 2.7.
 */
import { create } from "zustand";

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
  setSession: (sessionId: string | null, sections: ScriptSection[]) => void;
}

export const useScriptStore = create<ScriptState>((set) => ({
  sessionId: null,
  sections: [],
  setSession: (sessionId, sections) => set({ sessionId, sections }),
}));

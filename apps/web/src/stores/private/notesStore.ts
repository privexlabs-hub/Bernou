/**
 * PRIVATE store: per-slide speaker notes. Never imported by audience code.
 */
import { create } from "zustand";
import type { NoteRecord } from "@/db/dexie";

interface NotesState {
  sessionId: string | null;
  bySlide: Record<number, string>;
  setSession: (sessionId: string | null, notes: NoteRecord[]) => void;
  setNote: (slideIndex: number, body: string) => void;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  sessionId: null,
  bySlide: {},
  setSession: (sessionId, notes) => set({ sessionId, bySlide: Object.fromEntries(notes.map((n) => [n.slideIndex, n.body])) }),
  setNote: (slideIndex, body) => set({ bySlide: { ...get().bySlide, [slideIndex]: body } }),
}));

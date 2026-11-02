/**
 * PRIVATE store: teleprompter settings and playback state.
 * Full scroll model lands in step 2.8; settings are needed now for persistence.
 */
import { create } from "zustand";
import { DEFAULT_TELEPROMPTER, type TeleprompterSettings } from "@/db/dexie";

interface TeleprompterState {
  settings: TeleprompterSettings;
  loadSettings: (s: TeleprompterSettings) => void;
  patchSettings: (p: Partial<TeleprompterSettings>) => void;
}

export const useTeleprompterStore = create<TeleprompterState>((set, get) => ({
  settings: structuredClone(DEFAULT_TELEPROMPTER),
  loadSettings: (settings) => set({ settings: structuredClone(settings) }),
  patchSettings: (p) => set({ settings: { ...get().settings, ...p } }),
}));

/**
 * PRIVATE store: the open session's presenter-only metadata and the import
 * progress UI state. Session title and source file name are NOT public.
 */
import { create } from "zustand";
import type { SessionRecord } from "@/db/dexie";

export interface ImportStatus {
  active: boolean;
  fraction: number;
  stage: string;
  error: string | null;
  warnings: string[];
}

interface SessionState {
  session: SessionRecord | null;
  loading: boolean;
  loadError: string | null;
  importStatus: ImportStatus;
  setSession: (s: SessionRecord | null) => void;
  setLoading: (loading: boolean, loadError?: string | null) => void;
  setImportStatus: (patch: Partial<ImportStatus>) => void;
}

export const IDLE_IMPORT: ImportStatus = { active: false, fraction: 0, stage: "", error: null, warnings: [] };

export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  loading: true,
  loadError: null,
  importStatus: IDLE_IMPORT,
  setSession: (session) => set({ session }),
  setLoading: (loading, loadError = null) => set({ loading, loadError }),
  setImportStatus: (patch) => set({ importStatus: { ...get().importStatus, ...patch } }),
}));

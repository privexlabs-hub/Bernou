/**
 * PRIVATE store: recording state, timer and results. Never imported by audience
 * code, and nothing here travels over the audience channel.
 */
import { create } from "zustand";
import type { RecordingRecord } from "@/db/dexie";

export type RecordingStatus = "idle" | "preparing" | "recording" | "stopping";

interface RecordingState {
  status: RecordingStatus;
  startedAt: number;
  /** Not fatal: shown beside the controls while recording. */
  warning: string | null;
  /** Why the last recording couldn't start or had to stop early. */
  error: string | null;
  /** The recording that just finished, for the review dialog. */
  finished: RecordingRecord | null;
  /** How the most recent stop ended, for Emergency Stop's report. */
  lastOutcome: "saved" | "failed" | null;
  set: (patch: Partial<Omit<RecordingState, "set">>) => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  status: "idle",
  startedAt: 0,
  warning: null,
  error: null,
  finished: null,
  lastOutcome: null,
  set,
}));

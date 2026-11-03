/**
 * PRIVATE store: teleprompter settings (persisted per session) and live
 * playback state (scroll model). Never imported by audience code.
 */
import { create } from "zustand";
import { DEFAULT_TELEPROMPTER, type TeleprompterSettings } from "@/db/dexie";
import * as SM from "@/features/teleprompter/scrollModel";

interface TeleprompterState {
  settings: TeleprompterSettings;
  model: SM.ScrollModel;
  /** Whether the prompter's tab is showing. It only moves while it can be read. */
  visible: boolean;
  setVisible: (visible: boolean) => void;
  /** Back to the top, stopped: for leaving a session. */
  resetPlayback: () => void;
  loadSettings: (s: TeleprompterSettings) => void;
  patchSettings: (p: Partial<TeleprompterSettings>) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => void;
  reset: () => void;
  nudge: (px: number) => void;
  seek: (px: number) => void;
  setMaxPosition: (px: number) => void;
  tick: (ts: number) => void;
  speedUp: () => void;
  speedDown: () => void;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const useTeleprompterStore = create<TeleprompterState>((set, get) => ({
  settings: structuredClone(DEFAULT_TELEPROMPTER),
  model: SM.createScrollModel(DEFAULT_TELEPROMPTER.speed),
  visible: false,
  // Forgets the last tick, or the gap would count as elapsed time on return.
  setVisible: (visible) => set({ visible, model: { ...get().model, lastTs: null } }),
  resetPlayback: () => set({ model: SM.createScrollModel(get().settings.speed) }),
  // Over the defaults: rows saved before a setting existed don't have it.
  loadSettings: (settings) => set({ settings: { ...DEFAULT_TELEPROMPTER, ...structuredClone(settings) }, model: SM.setSpeed(SM.stop(get().model), settings.speed) }),
  patchSettings: (p) => {
    const settings = { ...get().settings, ...p, ...(p.speed !== undefined && { speed: SM.clampSpeed(p.speed) }) };
    set({ settings, model: p.speed !== undefined ? SM.setSpeed(get().model, settings.speed) : get().model });
  },
  play: () => set({ model: get().model.status === "paused" ? SM.resume(get().model, now()) : SM.start(get().model, now()) }),
  pause: () => set({ model: SM.pause(get().model) }),
  toggle: () => set({ model: SM.toggle(get().model, now()) }),
  stop: () => set({ model: SM.stop(get().model) }),
  reset: () => set({ model: SM.reset(get().model) }),
  nudge: (px) => set({ model: SM.nudge(get().model, px) }),
  seek: (px) => set({ model: SM.seek(get().model, px) }),
  setMaxPosition: (px) => {
    const m = SM.setMaxPosition(get().model, px);
    if (m !== get().model) set({ model: m });
  },
  tick: (ts) => {
    const m = SM.tick(get().model, ts);
    if (m !== get().model) set({ model: m });
  },
  speedUp: () => get().patchSettings({ speed: SM.nextSpeed(get().settings.speed, 1) }),
  speedDown: () => get().patchSettings({ speed: SM.nextSpeed(get().settings.speed, -1) }),
}));

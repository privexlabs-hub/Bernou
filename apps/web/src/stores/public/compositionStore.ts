/**
 * PUBLIC store: composition settings (output profile, layout, camera overlay
 * geometry/appearance, branding). Everything here is intended for the
 * audience and crosses the boundary via the audience bridge.
 *
 * The camera *deviceId* is public (it's an opaque id, needed so the audience
 * window can open the same camera). Camera *labels* are private and live in
 * the devices store.
 */
import { create } from "zustand";
import type { CompositionSettings } from "@/db/dexie";
import { DEFAULT_COMPOSITION } from "@/db/dexie";

type Camera = CompositionSettings["camera"];
type Branding = CompositionSettings["branding"];

interface CompositionState extends CompositionSettings {
  /** Opaque id of the camera to show, or null if none selected. */
  cameraDeviceId: string | null;
  load: (c: CompositionSettings) => void;
  setProfile: (p: CompositionSettings["profile"]) => void;
  setLayout: (l: CompositionSettings["layout"]) => void;
  setBackground: (c: string) => void;
  patchCamera: (patch: Partial<Camera>) => void;
  setCameraDeviceId: (id: string | null) => void;
  patchBranding: (patch: Partial<Branding>) => void;
  snapshot: () => CompositionSettings;
}

export const useCompositionStore = create<CompositionState>((set, get) => ({
  ...structuredClone(DEFAULT_COMPOSITION),
  cameraDeviceId: null,
  load: (c) => set({ ...structuredClone(c) }),
  setProfile: (profile) => set({ profile }),
  setLayout: (layout) => set({ layout }),
  setBackground: (background) => set({ background }),
  patchCamera: (patch) => set({ camera: { ...get().camera, ...patch } }),
  setCameraDeviceId: (cameraDeviceId) => set({ cameraDeviceId }),
  patchBranding: (patch) => set({ branding: { ...get().branding, ...patch } }),
  snapshot: () => {
    const { profile, background, layout, camera, branding } = get();
    return structuredClone({ profile, background, layout, camera, branding });
  },
}));

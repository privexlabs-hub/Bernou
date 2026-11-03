/**
 * PUBLIC store: marks on the slides, and the pointer. What's here for the active
 * slide is drawn on the audience output. Coordinates are integers relative to
 * the slide (see INK_COORD_MAX), so marks stay on the same part of the slide
 * whatever the output size.
 */
import { create } from "zustand";
import { MAX_INK_POINTS, MAX_INK_STROKES, type InkColor, type InkStroke } from "@bernou/audience-protocol";

type StrokeList = InkStroke[];

interface InkState {
  bySlide: Record<number, StrokeList>;
  pointer: { x: number; y: number } | null;
  load: (bySlide: Record<number, StrokeList>) => void;
  setPointer: (p: { x: number; y: number } | null) => void;
  /** Returns false if the slide can't take any more. */
  beginStroke: (slide: number, tool: InkStroke["tool"], color: InkColor, x: number, y: number) => boolean;
  extendStroke: (slide: number, x: number, y: number) => void;
  setStrokes: (slide: number, strokes: StrokeList) => void;
  clearSlide: (slide: number) => void;
}

export const inkPointCount = (strokes: readonly InkStroke[] | undefined) => (strokes ?? []).reduce((n, s) => n + s.points.length / 2, 0);

export const useInkStore = create<InkState>((set, get) => ({
  bySlide: {},
  pointer: null,
  load: (bySlide) => set({ bySlide, pointer: null }),
  // Skipped when nothing changes: every change here is a payload to the audience.
  setPointer: (pointer) => {
    if (pointer !== get().pointer) set({ pointer });
  },
  beginStroke: (slide, tool, color, x, y) => {
    const strokes = get().bySlide[slide] ?? [];
    if (strokes.length >= MAX_INK_STROKES || inkPointCount(strokes) >= MAX_INK_POINTS) return false;
    set({ bySlide: { ...get().bySlide, [slide]: [...strokes, { tool, color, points: [x, y] }] } });
    return true;
  },
  extendStroke: (slide, x, y) => {
    const strokes = get().bySlide[slide];
    const last = strokes?.at(-1);
    if (!strokes || !last || inkPointCount(strokes) >= MAX_INK_POINTS) return;
    set({ bySlide: { ...get().bySlide, [slide]: [...strokes.slice(0, -1), { ...last, points: [...last.points, x, y] }] } });
  },
  setStrokes: (slide, strokes) => set({ bySlide: { ...get().bySlide, [slide]: strokes } }),
  clearSlide: (slide) => {
    const { [slide]: _gone, ...rest } = get().bySlide;
    set({ bySlide: rest });
  },
}));

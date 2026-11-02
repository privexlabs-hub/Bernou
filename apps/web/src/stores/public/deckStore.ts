/**
 * PUBLIC store: the deck (rasterised slides) and the active slide index.
 *
 * "Public" means: the audience bridge may read from it. It therefore holds
 * ONLY what the audience may see — bitmaps and dimensions. The source file
 * name and session title are presenter-only and live in sessionStore (private).
 */
import { create } from "zustand";

export interface DeckSlide {
  /** Opaque id used as the asset key across the audience channel. */
  assetId: string;
  index: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  blob: Blob;
  /** Presenter-side thumbnail. Not sent to the audience. */
  thumbUrl: string;
}

interface DeckState {
  slides: DeckSlide[];
  activeIndex: number;
  setSlides: (slides: DeckSlide[]) => void;
  setActiveIndex: (i: number) => void;
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  clear: () => void;
}

export const useDeckStore = create<DeckState>((set, get) => ({
  slides: [],
  activeIndex: 0,
  setSlides: (slides) => {
    for (const s of get().slides) URL.revokeObjectURL(s.thumbUrl);
    set({ slides, activeIndex: 0 });
  },
  setActiveIndex: (i) => {
    const n = get().slides.length;
    if (n === 0) return set({ activeIndex: 0 });
    set({ activeIndex: Math.min(n - 1, Math.max(0, i)) });
  },
  next: () => get().setActiveIndex(get().activeIndex + 1),
  prev: () => get().setActiveIndex(get().activeIndex - 1),
  first: () => get().setActiveIndex(0),
  last: () => get().setActiveIndex(get().slides.length - 1),
  clear: () => {
    for (const s of get().slides) URL.revokeObjectURL(s.thumbUrl);
    set({ slides: [], activeIndex: 0 });
  },
}));

export function selectActiveSlide(s: DeckState): DeckSlide | null {
  return s.slides[s.activeIndex] ?? null;
}

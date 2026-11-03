/**
 * PRIVATE store: which annotation tool is in the presenter's hand. Kept apart
 * from the marks themselves, so that picking a tool sends nothing to the audience.
 */
import { create } from "zustand";
import { INK_COLORS, type InkColor } from "@bernou/audience-protocol";

export type InkTool = "pointer" | "pen" | "highlighter" | "eraser";

interface InkToolState {
  tool: InkTool | null;
  color: InkColor;
  setTool: (tool: InkTool | null) => void;
  setColor: (color: InkColor) => void;
}

export const useInkToolStore = create<InkToolState>((set) => ({
  tool: null,
  color: INK_COLORS[0],
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
}));

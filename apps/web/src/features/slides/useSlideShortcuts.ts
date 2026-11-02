/**
 * Slide navigation shortcuts. Ignored while typing in an editable element so
 * the script editor / notes keep normal keyboard behaviour.
 */
import { useEffect } from "react";
import { useDeckStore } from "@/stores/public/deckStore";

export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useSlideShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const d = useDeckStore.getState();
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          d.next();
          e.preventDefault();
          break;
        case "ArrowLeft":
        case "PageUp":
          d.prev();
          e.preventDefault();
          break;
        case "Home":
          d.first();
          e.preventDefault();
          break;
        case "End":
          d.last();
          e.preventDefault();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

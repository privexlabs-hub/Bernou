/**
 * Slide navigation shortcuts. Ignored while typing in an editable element so
 * the script editor / notes keep normal keyboard behaviour.
 */
import { useEffect } from "react";
import { useDeckStore } from "@/stores/public/deckStore";

const INTERACTIVE_ROLES = new Set(["slider", "spinbutton", "combobox", "listbox", "option", "menu", "menuitem", "tab", "tablist", "switch", "textbox", "dialog"]);

/**
 * True when a global keyboard shortcut must NOT fire because the key belongs
 * to the focused control: text fields, and any ARIA widget that uses arrow
 * keys itself (sliders, tabs, selects, menus…). Found by a test where arrow
 * keys on the font-size slider also flipped slides.
 */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const role = t.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  // inside an open Radix popover/menu/dialog
  return !!t.closest("[role=dialog], [role=menu], [role=listbox], [data-radix-popper-content-wrapper]");
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

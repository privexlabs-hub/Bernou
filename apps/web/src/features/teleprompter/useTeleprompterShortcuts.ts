/**
 * Global teleprompter shortcut: Space toggles play/pause when the user is not
 * typing in a field. All other prompter keys apply only when the prompter
 * viewport itself has focus (see handlePrompterKey), so slide-navigation
 * arrows keep working elsewhere.
 */
import { useEffect } from "react";
import { isEditableTarget } from "@/features/slides/useSlideShortcuts";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";

export function useTeleprompterShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("button, [role=button], [role=tab], [role=switch], [role=slider]")) return;
      useTeleprompterStore.getState().toggle();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

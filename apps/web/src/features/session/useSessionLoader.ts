/**
 * Loads a session from IndexedDB into the stores, runs any pending import
 * handed over from the dashboard, and persists store changes back.
 */
import { useEffect } from "react";
import { getSession, updateSession } from "@/db/repositories/sessions";
import { getSlides } from "@/db/repositories/slides";
import { getScript } from "@/db/repositories/scripts";
import { getInk } from "@/db/repositories/ink";
import { getNotes } from "@/db/repositories/notes";
import { useSessionStore, IDLE_IMPORT } from "@/stores/private/sessionStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { useCompositionStore } from "@/stores/public/compositionStore";
import { useInkStore } from "@/stores/public/inkStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { useNotesStore } from "@/stores/private/notesStore";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { takePendingImport } from "./pendingImport";
import { toDeckSlides } from "./deckSlides";
import { importDeck } from "./importDeck";

export function useSessionLoader(sessionId: string | undefined) {
  const setSession = useSessionStore((s) => s.setSession);
  const setLoading = useSessionStore((s) => s.setLoading);
  const setImportStatus = useSessionStore((s) => s.setImportStatus);

  useEffect(() => {
    let cancelled = false;
    const deck = useDeckStore.getState();
    const comp = useCompositionStore.getState();

    (async () => {
      setLoading(true);
      if (!sessionId) return setLoading(false, "No session id");
      const rec = await getSession(sessionId);
      if (cancelled) return;
      if (!rec) return setLoading(false, "This presentation no longer exists.");

      setSession(rec);
      comp.load(rec.composition);
      useTeleprompterStore.getState().loadSettings(rec.teleprompter);

      const [slides, script, notes, ink] = await Promise.all([getSlides(sessionId), getScript(sessionId), getNotes(sessionId), getInk(sessionId)]);
      if (cancelled) return;
      deck.setSlides(toDeckSlides(slides, rec.deckRevision ?? 0));
      deck.setActiveIndex(rec.activeSlideIndex);
      useScriptStore.getState().setSession(sessionId, script?.sections ?? []);
      useNotesStore.getState().setSession(sessionId, notes);
      useInkStore.getState().load(ink);
      setLoading(false);

      const pending = takePendingImport(sessionId);
      if (pending) await importDeck(sessionId, pending);
    })().catch((e) => {
      if (!cancelled) setLoading(false, (e as Error).message);
    });

    return () => {
      cancelled = true;
      deck.clear();
      setSession(null);
      // Private text must not stay on screen while the next session loads.
      useScriptStore.getState().setSession(null, []);
      useNotesStore.getState().setSession(null, []);
      useInkStore.getState().load({});
      useTeleprompterStore.getState().resetPlayback();
      setImportStatus(IDLE_IMPORT);
    };
  }, [sessionId, setSession, setLoading, setImportStatus]);
}

/** Persist the active slide index and composition settings (debounced). */
export function useSessionPersistence(sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (t) clearTimeout(t);
      t = null;
      // activeSlideIndex is written immediately below, never here, so that a
      // deck being cleared on unmount can't overwrite the saved position.
      void updateSession(sessionId, {
        composition: useCompositionStore.getState().snapshot(),
        teleprompter: useTeleprompterStore.getState().settings,
      });
    };
    const schedule = () => {
      if (t) clearTimeout(t);
      t = setTimeout(flush, 250);
    };
    // A slide change is tiny and is what a presenter most expects to survive
    // a crash or reload, so it is written immediately.
    const u1 = useDeckStore.subscribe((s, p) => {
      // Ignore transitions caused by clearing the deck (unmount / reimport).
      if (s.activeIndex !== p.activeIndex && s.slides.length > 0) void updateSession(sessionId, { activeSlideIndex: s.activeIndex });
    });
    const u2 = useCompositionStore.subscribe(schedule);
    const u3 = useTeleprompterStore.subscribe((s, p) => s.settings !== p.settings && schedule());
    const onHide = () => {
      if (t) flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      u1();
      u2();
      u3();
      window.removeEventListener("pagehide", onHide);
      if (t) flush();
    };
  }, [sessionId]);
}

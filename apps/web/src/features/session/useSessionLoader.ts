/**
 * Loads a session from IndexedDB into the stores, runs any pending import
 * handed over from the dashboard, and persists store changes back.
 */
import { useEffect } from "react";
import { getSession, updateSession } from "@/db/repositories/sessions";
import { getSlides, replaceSlides } from "@/db/repositories/slides";
import { getScript } from "@/db/repositories/scripts";
import { getNotes } from "@/db/repositories/notes";
import { useSessionStore, IDLE_IMPORT } from "@/stores/private/sessionStore";
import { useDeckStore, type DeckSlide } from "@/stores/public/deckStore";
import { useCompositionStore } from "@/stores/public/compositionStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { useNotesStore } from "@/stores/private/notesStore";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { takePendingImport } from "./pendingImport";
import { runImport } from "./runImport";
import type { SlideRecord } from "@/db/dexie";

function toDeckSlides(records: SlideRecord[]): DeckSlide[] {
  return records
    .sort((a, b) => a.index - b.index)
    .map((r) => ({
      assetId: `${r.sessionId}-${r.index}`.replace(/[^A-Za-z0-9_-]/g, ""),
      index: r.index,
      width: r.width,
      height: r.height,
      mime: r.mime,
      blob: r.blob,
      thumbUrl: URL.createObjectURL(r.thumb),
    }));
}

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

      const [slides, script, notes] = await Promise.all([getSlides(sessionId), getScript(sessionId), getNotes(sessionId)]);
      if (cancelled) return;
      deck.setSlides(toDeckSlides(slides));
      deck.setActiveIndex(rec.activeSlideIndex);
      useScriptStore.getState().setSession(sessionId, script?.sections ?? []);
      useNotesStore.getState().setSession(sessionId, notes);
      setLoading(false);

      const pending = takePendingImport(sessionId);
      if (pending) {
        setImportStatus({ ...IDLE_IMPORT, active: true, stage: "Starting…" });
        const result = await runImport(pending, (p) => setImportStatus({ fraction: p.fraction, stage: p.stage }));
        if (cancelled) return;
        if (result.ok) {
          await replaceSlides(sessionId, result.slides);
          const fresh = await getSlides(sessionId);
          deck.setSlides(toDeckSlides(fresh));
          await updateSession(sessionId, { sourceFileName: pending.name, sourceKind: result.kind });
          const updated = await getSession(sessionId);
          if (updated) setSession(updated);
          setImportStatus({ ...IDLE_IMPORT, warnings: result.warnings });
        } else {
          setImportStatus({ ...IDLE_IMPORT, error: result.error });
        }
      }
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

/**
 * The one way slides get into a presentation, from the dashboard or the studio.
 *
 * The presenter may leave while a large file renders. The import still finishes
 * for the presentation it was meant for, but the screen is only updated if that
 * presentation is still the open one.
 */
import { getSession, updateSession } from "@/db/repositories/sessions";
import { getSlides, replaceSlides } from "@/db/repositories/slides";
import { IDLE_IMPORT, useSessionStore } from "@/stores/private/sessionStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { toDeckSlides } from "./deckSlides";
import { PPTX_REFUSED_CODE, runImport } from "./runImport";

const isOpen = (sessionId: string) => useSessionStore.getState().session?.id === sessionId;

/** Returns the error code, or null on success. */
export async function importDeck(sessionId: string, files: File[], afterSaved?: () => Promise<void> | void): Promise<string | null> {
  const { setImportStatus, setSession } = useSessionStore.getState();
  const status = (patch: Parameters<typeof setImportStatus>[0]) => {
    if (isOpen(sessionId)) setImportStatus(patch);
  };
  status({ ...IDLE_IMPORT, active: true, stage: "Starting…" });

  const result = await runImport(files, (p) => status({ fraction: p.fraction, stage: p.stage }));
  if (!result.ok) {
    status({ ...IDLE_IMPORT, error: result.code === PPTX_REFUSED_CODE ? null : result.error });
    return result.code;
  }

  const hadSlides = useDeckStore.getState().slides.length > 0 && isOpen(sessionId);
  const source = files.length === 1 ? files[0]!.name : `${result.slides.length} images`;
  try {
    const revision = await replaceSlides(sessionId, result.slides);
    await updateSession(sessionId, { sourceFileName: source, sourceKind: result.kind });
    await afterSaved?.();
    if (isOpen(sessionId)) {
      useDeckStore.getState().setSlides(toDeckSlides(await getSlides(sessionId), revision));
      const updated = await getSession(sessionId);
      if (updated) setSession(updated);
    }
  } catch (e) {
    status({ ...IDLE_IMPORT, error: `The slides couldn't be saved (${(e as Error).message}). Your previous slides are unchanged.` });
    return "storage";
  }
  const count = `${result.slides.length} slide${result.slides.length === 1 ? "" : "s"}`;
  status({ ...IDLE_IMPORT, warnings: result.warnings, done: `${hadSlides ? "Replaced with" : "Imported"} ${source} · ${count}` });
  return null;
}

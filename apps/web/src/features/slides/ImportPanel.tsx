import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Upload } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { deleteNotes, getNotes } from "@/db/repositories/notes";
import { importDeck } from "@/features/session/importDeck";
import { checkImportFiles, PPTX_REFUSED_CODE } from "@/features/session/runImport";
import { useNotesStore } from "@/stores/private/notesStore";
import { useRecordingStore } from "@/stores/private/recordingStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { useSessionStore, IDLE_IMPORT } from "@/stores/private/sessionStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { PptxGuidanceDialog } from "./PptxGuidanceDialog";
import { useFileDrop } from "./useFileDrop";

const SESSION_WAIT_MS = 10_000;

/** A file can be picked before the session has finished loading, and must not be lost. */
function waitForSession(): Promise<string | null> {
  const open = useSessionStore.getState().session?.id;
  if (open) return Promise.resolve(open);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, SESSION_WAIT_MS);
    const unsubscribe = useSessionStore.subscribe((s) => {
      if (!s.session) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(s.session.id);
    });
  });
}

/** Clears only once the new deck is saved, so a failed import loses nothing. */
async function clearNotesAndLinks(sessionId: string) {
  await deleteNotes(sessionId);
  useNotesStore.getState().setSession(sessionId, []);
  const script = useScriptStore.getState();
  for (const s of script.sections) if (s.slideIndex !== null) script.updateSection(s.id, { slideIndex: null });
}

export function ImportPanel({ compact }: { compact: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const status = useSessionStore((s) => s.importStatus);
  const setStatus = useSessionStore((s) => s.setImportStatus);
  const recording = useRecordingStore((s) => s.status !== "idle");
  const [pptxOpen, setPptxOpen] = useState(false);
  const [asking, setAsking] = useState<{ sessionId: string; files: File[] } | null>(null);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || useRecordingStore.getState().status !== "idle") return;
      const list = Array.from(files);
      const refused = checkImportFiles(list);
      if (refused) {
        if (refused.code === PPTX_REFUSED_CODE) setPptxOpen(true);
        setStatus({ ...IDLE_IMPORT, error: refused.code === PPTX_REFUSED_CODE ? null : refused.error });
        return;
      }
      setStatus({ ...IDLE_IMPORT, active: true, stage: "Starting…" });
      const sessionId = await waitForSession();
      if (!sessionId) {
        setStatus({ ...IDLE_IMPORT, error: "The presentation didn't finish loading. Reload the page and try again." });
        return;
      }
      const hasSlides = useDeckStore.getState().slides.length > 0;
      const hasLinks = useScriptStore.getState().sections.some((s) => s.slideIndex !== null);
      const hasNotes = (await getNotes(sessionId)).length > 0;
      if (hasSlides && (hasLinks || hasNotes)) {
        setStatus(IDLE_IMPORT);
        setAsking({ sessionId, files: list });
        return;
      }
      await importDeck(sessionId, list);
    },
    [setStatus],
  );
  const drop = useFileDrop((files) => void onFiles(files));

  return (
    <div {...drop} data-testid="studio-drop">
      <input
        ref={input}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg,image/webp,.pptx"
        className="hidden"
        data-testid="studio-import-input"
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {status.active ? (
        <div className="space-y-1.5 px-1" data-testid="import-progress">
          <div className="h-1 overflow-hidden rounded bg-secondary">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(status.fraction * 100)}%` }} />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{status.stage}</p>
        </div>
      ) : (
        <Button
          variant={compact ? "outline" : "secondary"}
          size="sm"
          className="w-full"
          disabled={recording}
          title={recording ? "Stop the recording before changing slides" : undefined}
          onClick={() => input.current?.click()}
          data-testid="studio-import"
        >
          <Upload /> {compact ? "Replace slides" : "Import PDF or images"}
        </Button>
      )}
      {status.done && (
        <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] text-muted-foreground" role="status" data-testid="import-done">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-live" /> <span className="min-w-0 break-words">{status.done}</span>
        </p>
      )}
      {status.error && (
        <p className="mt-2 flex items-start gap-1.5 px-1 text-xs text-destructive" role="alert" data-testid="import-error">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {status.error}
        </p>
      )}
      {status.warnings.map((w) => (
        <p key={w} className="mt-2 flex items-start gap-1.5 rounded border border-primary/40 bg-primary/10 p-2 text-[11px] text-foreground" role="status" data-testid="import-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-primary" /> {w}
        </p>
      ))}

      <PptxGuidanceDialog open={pptxOpen} onOpenChange={setPptxOpen} onChooseFile={() => input.current?.click()} />

      <Dialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent data-testid="replace-prompt">
          <DialogHeader>
            <DialogTitle>Keep your notes and slide links?</DialogTitle>
            <DialogDescription>Your script stays either way. Keep them if this is an updated version of the same deck. Clear them if it&apos;s a different deck, or old notes will show on the wrong slides. Marks on the slides are always cleared.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsking(null)} data-testid="replace-cancel">
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (asking) void importDeck(asking.sessionId, asking.files, () => clearNotesAndLinks(asking.sessionId));
                setAsking(null);
              }}
              data-testid="replace-clear"
            >
              Clear them
            </Button>
            <Button
              onClick={() => {
                if (asking) void importDeck(asking.sessionId, asking.files);
                setAsking(null);
              }}
              data-testid="replace-keep"
            >
              Keep by slide number
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

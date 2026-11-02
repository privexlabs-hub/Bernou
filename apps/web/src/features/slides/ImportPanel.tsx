import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { PPTX_EXPORT_STEPS, PPTX_GUIDANCE_BODY, PPTX_GUIDANCE_TITLE } from "@bernou/import-core";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { useSessionStore, IDLE_IMPORT } from "@/stores/private/sessionStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { runImport, PPTX_REFUSED_CODE } from "@/features/session/runImport";
import { replaceSlides, getSlides } from "@/db/repositories/slides";
import { getSession, updateSession } from "@/db/repositories/sessions";

export function ImportPanel({ compact }: { compact: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const status = useSessionStore((s) => s.importStatus);
  const setStatus = useSessionStore((s) => s.setImportStatus);
  const session = useSessionStore((s) => s.session);
  const setSession = useSessionStore((s) => s.setSession);
  const [pptxOpen, setPptxOpen] = useState(false);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!session || !files || files.length === 0) return;
      const list = Array.from(files);
      setStatus({ ...IDLE_IMPORT, active: true, stage: "Starting…" });
      const result = await runImport(list, (p) => setStatus({ fraction: p.fraction, stage: p.stage }));
      if (!result.ok) {
        if (result.code === PPTX_REFUSED_CODE) setPptxOpen(true);
        setStatus({ ...IDLE_IMPORT, error: result.code === PPTX_REFUSED_CODE ? null : result.error });
        return;
      }
      await replaceSlides(session.id, result.slides);
      const fresh = await getSlides(session.id);
      useDeckStore.getState().setSlides(
        fresh
          .sort((a, b) => a.index - b.index)
          .map((r) => ({
            assetId: `${r.sessionId}-${r.index}`.replace(/[^A-Za-z0-9_-]/g, ""),
            index: r.index,
            width: r.width,
            height: r.height,
            mime: r.mime,
            blob: r.blob,
            thumbUrl: URL.createObjectURL(r.thumb),
          })),
      );
      await updateSession(session.id, { sourceFileName: list.length === 1 ? list[0]!.name : `${list.length} images`, sourceKind: result.kind });
      const updated = await getSession(session.id);
      if (updated) setSession(updated);
      setStatus({ ...IDLE_IMPORT, warnings: result.warnings });
    },
    [session, setStatus, setSession],
  );

  return (
    <div>
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
        <Button variant={compact ? "outline" : "secondary"} size="sm" className="w-full" onClick={() => input.current?.click()} data-testid="studio-import">
          <Upload /> {compact ? "Replace slides" : "Import PDF or images"}
        </Button>
      )}
      {status.error && (
        <p className="mt-2 flex items-start gap-1.5 px-1 text-[11px] text-destructive" role="alert" data-testid="import-error">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {status.error}
        </p>
      )}
      {status.warnings.map((w) => (
        <p key={w} className="mt-2 flex items-start gap-1.5 rounded border border-primary/40 bg-primary/10 p-2 text-[11px] text-foreground" role="status" data-testid="import-warning">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-primary" /> {w}
        </p>
      ))}

      <Dialog open={pptxOpen} onOpenChange={setPptxOpen}>
        <DialogContent data-testid="pptx-guidance">
          <DialogHeader>
            <DialogTitle>{PPTX_GUIDANCE_TITLE}</DialogTitle>
            <DialogDescription>{PPTX_GUIDANCE_BODY}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {PPTX_EXPORT_STEPS.map((s) => (
              <li key={s.app} className="rounded-md border border-border/70 bg-panel-raised p-2.5">
                <div className="text-xs font-semibold">{s.app}</div>
                <div className="text-xs text-muted-foreground">{s.steps}</div>
              </li>
            ))}
          </ul>
          <Button
            onClick={() => {
              setPptxOpen(false);
              input.current?.click();
            }}
          >
            <Upload /> Choose the exported PDF
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Export: progress, cancel, then the new recording saved and downloaded. */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import type { EditProject, RecordingRecord } from "@/db/dexie";
import { addRecording } from "@/db/repositories/recordings";
import { downloadRecording, recordingFileName } from "@/features/recording/recordingFile";
import { newId } from "@/lib/id";
import { formatBytes, formatDuration } from "@/lib/format";
import type { EditorWorker } from "./export/client";
import { outputDir, RECORDINGS_DIR, TEMP_DIR, type SourceInfo } from "./export/protocol";

type State = { phase: "running"; done: number; total: number; startedAt: number } | { phase: "done"; rec: RecordingRecord | null; downloaded: boolean } | { phase: "error"; message: string } | { phase: "cancelled" };

export function ExportDialog({ open, onClose, worker, source, original, project, info, audioOnly }: { open: boolean; onClose: () => void; worker: EditorWorker; source: Blob; original: RecordingRecord; project: EditProject; info: SourceInfo; audioOnly: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!open) {
      started.current = false;
      setState(null);
      return;
    }
    if (started.current) return;
    started.current = true;
    const ext = audioOnly ? "wav" : info.output!.container;
    const fileName = `${newId()}.${ext}`;
    setState({ phase: "running", done: 0, total: 1, startedAt: performance.now() });
    void (async () => {
      try {
        const r = await worker.export({ file: source, project, fileName, dir: audioOnly ? TEMP_DIR : RECORDINGS_DIR, audioOnly }, (done, total) => setState((s) => (s?.phase === "running" ? { ...s, done, total } : s)));
        if (r.cancelled) return setState({ phase: "cancelled" });
        if (audioOnly) {
          const file = await (await (await outputDir(TEMP_DIR)).getFileHandle(r.fileName)).getFile();
          const url = URL.createObjectURL(file);
          const a = document.createElement("a");
          a.href = url;
          a.download = recordingFileName(`${original.title} (audio)`, Date.now(), "wav");
          document.body.append(a);
          a.click();
          a.remove();
          // A temporary file: the WAV isn't kept in Bernou.
          setTimeout(() => {
            URL.revokeObjectURL(url);
            void outputDir(TEMP_DIR).then((d) => d.removeEntry(r.fileName)).catch(() => undefined);
          }, 60_000);
          return setState({ phase: "done", rec: null, downloaded: true });
        }
        const rec: RecordingRecord = {
          id: newId(),
          sessionId: original.sessionId,
          title: `${original.title} (edited)`,
          createdAt: Date.now(),
          durationMs: Math.round(r.durationMs),
          mime: r.mime,
          extension: r.extension,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
          opfsPath: r.fileName,
          savedToDisk: false,
          status: "complete",
          editedFrom: original.id,
        };
        await addRecording(rec);
        const downloaded = await downloadRecording(rec);
        setState({ phase: "done", rec, downloaded });
      } catch (e) {
        setState({ phase: "error", message: (e as Error).message });
      }
    })();
  }, [open, worker, source, project, audioOnly, info, original]);

  const running = state?.phase === "running";
  const pct = running ? Math.min(100, Math.round((state.done / Math.max(1, state.total)) * 100)) : 100;
  const eta = running && state.done > 0 ? ((performance.now() - state.startedAt) / state.done) * (state.total - state.done) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent data-testid="editor-export-dialog" onEscapeKeyDown={(e) => running && e.preventDefault()} onPointerDownOutside={(e) => running && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{audioOnly ? "Audio only" : "Export"}</DialogTitle>
          <DialogDescription>
            {audioOnly ? "The edited sound as a WAV file." : `A new recording, saved in Bernou next to the original and downloaded. ${info.output?.container === "mp4" ? "MP4 (H.264, AAC)" : "WebM (VP9, Opus): this browser can't make MP4"}. The original isn't changed.`}
          </DialogDescription>
        </DialogHeader>
        {running && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded bg-border/60">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} data-testid="editor-export-progress" data-pct={pct} />
            </div>
            <p className="text-xs text-muted-foreground">{pct}%{eta !== null && ` · about ${formatDuration(eta)} left`}. You can keep this tab in the background.</p>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => worker.cancel()} data-testid="editor-export-cancel">Cancel</Button>
            </div>
          </div>
        )}
        {state?.phase === "done" && (
          <div className="space-y-3" data-testid="editor-export-done">
            <p className="text-sm">{state.rec ? `Saved as "${state.rec.title}" · ${formatDuration(state.rec.durationMs)} · ${formatBytes(state.rec.bytes)}. ${state.downloaded ? "Downloaded." : "It couldn't be downloaded; try again from the dashboard."}` : "Downloaded."}</p>
            <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
          </div>
        )}
        {state?.phase === "cancelled" && (
          <div className="space-y-3" data-testid="editor-export-cancelled">
            <p className="text-sm">Cancelled. Nothing was saved.</p>
            <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
          </div>
        )}
        {state?.phase === "error" && (
          <div className="space-y-3" role="alert" data-testid="editor-export-error">
            <p className="text-sm text-destructive">The export failed: {state.message}. Nothing was saved.</p>
            <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

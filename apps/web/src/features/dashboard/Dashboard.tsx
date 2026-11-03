import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, Film, FileText, Plus, Settings, Trash2, Upload } from "lucide-react";
import { Button } from "@/ui/button";
import { TooltipProvider } from "@/ui/tooltip";
import { db, type RecordingRecord } from "@/db/dexie";
import { deleteRecording } from "@/db/repositories/recordings";
import { createSession, deleteSession, duplicateSession, renameSession } from "@/db/repositories/sessions";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";
import { SessionCard } from "./SessionCard";
import { SettingsDialog } from "./SettingsDialog";
import { downloadRecording } from "@/features/recording/recordingFile";
import { stashPendingImport } from "@/features/session/pendingImport";
import { BernouLogo } from "@/ui/logo";

export function Dashboard() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const sessions = useLiveQuery(() => db().sessions.orderBy("updatedAt").reverse().limit(24).toArray(), []);
  const scripts = useLiveQuery(() => db().scripts.orderBy("updatedAt").reverse().limit(8).toArray(), []);
  const recordings = useLiveQuery(() => db().recordings.orderBy("createdAt").reverse().limit(8).toArray(), []);
  const sessionTitles = useLiveQuery(async () => {
    const all = await db().sessions.toArray();
    return new Map(all.map((s) => [s.id, s.title]));
  }, []);

  const onNew = useCallback(async () => {
    const s = await createSession();
    navigate(`/studio/${s.id}`);
  }, [navigate]);

  const onImport = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const title = file.name.replace(/\.[^.]+$/, "");
      const s = await createSession(title);
      // The file is handed to the studio in memory; the studio runs the importer
      // (step 2.3) and persists rasterised slides. Nothing is uploaded anywhere.
      stashPendingImport(s.id, file);
      navigate(`/studio/${s.id}`);
    },
    [navigate],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-full bg-background">
        <header className="sticky top-0 z-10 border-b border-border/70 bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <div className="flex items-center gap-3">
              <BernouLogo className="h-6 w-6" />
              <span className="text-sm font-semibold tracking-tight">Bernou</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">Private presentation studio</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)} data-testid="open-settings">
              <Settings /> Settings
            </Button>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          <section className="mb-12">
            <h1 className="text-2xl font-semibold tracking-tight">Start</h1>
            <p className="mt-1 text-sm text-muted-foreground">Everything stays on this device. Nothing is uploaded.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={onNew}
                data-testid="new-presentation"
                className="panel group flex items-center gap-4 p-5 text-left transition-colors hover:border-primary/50"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Plus className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-medium">New presentation</span>
                  <span className="block text-xs text-muted-foreground">Blank session — add slides and a script in the studio</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                data-testid="import-presentation"
                className="panel group flex items-center gap-4 p-5 text-left transition-colors hover:border-primary/50"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-secondary text-foreground">
                  <Upload className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-medium">Import presentation</span>
                  <span className="block text-xs text-muted-foreground">PDF or images. PowerPoint: export to PDF first.</span>
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,.pptx"
                className="hidden"
                data-testid="import-file-input"
                onChange={(e) => {
                  void onImport(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </section>

          <section className="mb-12">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Recent presentations</h2>
              {sessions && sessions.length > 0 && <span className="text-xs text-muted-foreground">{sessions.length}</span>}
            </div>
            {sessions === undefined ? (
              <div className="text-xs text-muted-foreground">Loading…</div>
            ) : sessions.length === 0 ? (
              <EmptyState icon={<FileText />} text="No presentations yet." />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="recent-sessions">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <SessionCard
                      session={s}
                      onOpen={() => navigate(`/studio/${s.id}`)}
                      onRename={(t) => renameSession(s.id, t)}
                      onDuplicate={async () => {
                        await duplicateSession(s.id);
                      }}
                      onDelete={() => deleteSession(s.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-12 lg:grid-cols-2">
            <section>
              <h2 className="mb-4 text-sm font-semibold">Saved scripts</h2>
              {!scripts || scripts.length === 0 ? (
                <EmptyState icon={<FileText />} text="Scripts you write in the studio appear here." />
              ) : (
                <ul className="panel divide-y divide-border/70" data-testid="saved-scripts">
                  {scripts.map((sc) => {
                    const words = sc.sections.reduce((n, s) => n + s.body.split(/\s+/).filter(Boolean).length, 0);
                    return (
                      <li key={sc.sessionId}>
                        <button
                          type="button"
                          onClick={() => navigate(`/studio/${sc.sessionId}`)}
                          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-accent/40"
                        >
                          <span className="truncate text-sm">{sessionTitles?.get(sc.sessionId) ?? "Untitled presentation"}</span>
                          <span className="ml-4 shrink-0 text-xs text-muted-foreground">
                            {words} words · {formatRelative(sc.updatedAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-4 text-sm font-semibold">Recent recordings</h2>
              {!recordings || recordings.length === 0 ? (
                <EmptyState icon={<Film />} text="Recordings you make in the studio appear here, ready to download." />
              ) : (
                <ul className="panel divide-y divide-border/70" data-testid="recent-recordings">
                  {recordings.map((r) => (
                    <RecordingRow key={r.id} recording={r} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </main>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    </TooltipProvider>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="panel flex items-center gap-3 px-4 py-6 text-xs text-muted-foreground [&_svg]:size-4 [&_svg]:opacity-60">
      {icon}
      {text}
    </div>
  );
}

function RecordingRow({ recording: r }: { recording: RecordingRecord }) {
  const [missing, setMissing] = useState(false);
  const inProgress = r.status === "recording";
  return (
    <li className="flex items-center gap-3 px-4 py-3" data-testid="recording-row" data-status={r.status ?? "complete"}>
      <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
      {r.status === "interrupted" && <span className="shrink-0 text-xs text-destructive">Interrupted: may end abruptly</span>}
      {missing && (
        <span className="shrink-0 text-xs text-destructive" role="alert">
          File not found
        </span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDuration(r.durationMs)} · {formatBytes(r.bytes)} · .{r.extension}
      </span>
      <Button variant="ghost" size="icon-sm" disabled={inProgress} aria-label={`Download ${r.title}`} data-testid="recording-row-download" onClick={() => void downloadRecording(r).then((ok) => setMissing(!ok))}>
        <Download />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={inProgress}
        aria-label={`Delete ${r.title}`}
        data-testid="recording-row-delete"
        onClick={() => {
          if (confirm(`Delete the recording "${r.title}"? This can't be undone.`)) void deleteRecording(r);
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

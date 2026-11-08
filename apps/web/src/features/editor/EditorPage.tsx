/**
 * The editor page for one recording. Nothing here writes to the original:
 * edits are a saved project, and export makes a new recording.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Highlighter, Pause, Play, Redo2, RotateCcw, Scissors, Type, Undo2, VolumeX } from "lucide-react";
import { fixMp4FragmentGaps, readRecordingFile } from "@bernou/media-core/recorder";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { TooltipProvider } from "@/ui/tooltip";
import { db, type RecordingRecord } from "@/db/dexie";
import { getEditProject, saveEditProject } from "@/db/repositories/editProjects";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { isEditableTarget } from "@/features/slides/useSlideShortcuts";
import { addOverlay, addTrack, deleteOverlay, muteSection, newHighlight, newText, newTrack, removeSection, setOriginal } from "./edits";
import { newEditProject, normalizeProject } from "./project";
import { buildEnvelope, buildExportAudio, cachedAsset, closeAssets, importAudio, loadAsset } from "./audioAssets";
import { layout as computeLayout, toOutput } from "./timeline";
import { useEditorWorker, WorkerClosed } from "./export/client";
import { outputDir, TEMP_DIR, type SourceInfo } from "./export/protocol";
import { PreviewPlayer } from "./player";
import { Preview } from "./Preview";
import { TimelineView } from "./TimelineView";
import { fmt, Panels } from "./Panels";
import { ExportDialog } from "./ExportDialog";

const PEAKS_PER_SECOND = 100;
const AUTOSAVE_MS = 400;

type Loaded = { rec: RecordingRecord; source: Blob; url: string; info: SourceInfo; peaks: Float32Array | null };

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useEditorWorker();
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<PreviewPlayer | null>(null);
  const recordingId = useRef<string | null>(null);
  const [exporting, setExporting] = useState<null | "video" | "audio">(null);
  const [joinPreview, setJoinPreview] = useState<{ url: string; name: string } | { busy: true } | null>(null);
  const project = useEditorStore((s) => s.project);
  const { change, undo, redo, canUndo, canRedo } = useEditorStore();
  const ui = useEditorUi();

  // Load the recording, read it once, and open or start its project.
  useEffect(() => {
    if (!worker) return;
    let cancelled = false;
    useEditorUi.getState().reset();
    // Temporary files from an earlier visit (a closed tab mid-preview) aren't needed.
    void navigator.storage
      ?.getDirectory()
      .then((d) => d.removeEntry(TEMP_DIR, { recursive: true }))
      .catch(() => undefined);
    void (async () => {
      const rec = id ? await db().recordings.get(id) : undefined;
      if (!rec) return setError("This recording doesn't exist any more.");
      const file = await readRecordingFile(rec.opfsPath);
      if (!file) return setError("This recording's file can't be found.");
      // The fixed MP4 gives the video element a real duration and accurate seeking.
      const source = rec.extension === "mp4" ? new Blob([(await fixMp4FragmentGaps(file))?.blob ?? file], { type: rec.mime }) : new Blob([file], { type: rec.mime });
      let info: SourceInfo;
      try {
        info = await worker.probe(source);
      } catch (e) {
        if (cancelled || e instanceof WorkerClosed) return;
        return setError(`This recording can't be opened for editing (${(e as Error).message}).`);
      }
      if (cancelled) return;
      if (!info.output) return setError("This browser can't encode video, so it can't export edits. Try Chrome or Edge.");
      const saved = await getEditProject(rec.id);
      // Projects saved before a setting existed get its default.
      const project = normalizeProject(saved ?? newEditProject({ id: rec.id, durationMs: info.duration * 1000 }));
      // Added audio, decoded before the page shows, so play and export have it.
      const rate = info.hasAudio ? info.sampleRate : 48000;
      for (const t of project.audio.tracks) await loadAsset(rec.id, t.assetId, rate);
      if (cancelled) return;
      recordingId.current = rec.id;
      useEditorStore.getState().load(project);
      const url = URL.createObjectURL(source);
      setLoaded({ rec, source, url, info, peaks: null });
      if (info.hasAudio) {
        const a = await worker.decodeAudio(source, PEAKS_PER_SECOND).catch((e) => {
          if (e instanceof WorkerClosed) return null;
          throw e;
        });
        if (cancelled || !a) return;
        player.current?.setAudio(a.samples, a.sampleRate);
        setLoaded((l) => (l ? { ...l, peaks: a.peaks } : l));
      }
    })().catch((e) => {
      if (!cancelled && !(e instanceof WorkerClosed)) setError(`This recording can't be opened for editing (${(e as Error).message}).`);
    });
    return () => {
      cancelled = true;
      // Files no longer used by the project go, and decodes are forgotten.
      if (recordingId.current) void closeAssets(recordingId.current, useEditorStore.getState().project);
      useEditorStore.getState().close();
    };
  }, [id, worker]);

  useEffect(() => () => void (loaded && URL.revokeObjectURL(loaded.url)), [loaded?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave, debounced, and once more on leaving.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: typeof project = null;
    const unsub = useEditorStore.subscribe((s, prev) => {
      if (!s.project || s.project === prev.project || !prev.project || s.project.id !== prev.project.id) return;
      pending = s.project;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (pending) void saveEditProject(pending);
        pending = null;
      }, AUTOSAVE_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
      if (pending) void saveEditProject(pending);
    };
  }, []);

  const duration = loaded?.info.duration ?? 0;
  const l = useMemo(() => (project ? computeLayout({ duration, trim: project.trim, cuts: project.cuts, smoothJoins: project.smoothJoins }) : null), [project, duration]);

  /** Added audio and the music dip, for the preview. The same envelope the export gets. */
  const extras = useCallback(() => {
    const original = player.current?.originalSamples() ?? null;
    return { trackBuffer: cachedAsset, envelope: project && l ? buildEnvelope(project, l, original) : null };
  }, [project, l]);
  const exportAudio = useCallback(() => buildExportAudio(project!, loaded!.info, l!, player.current?.originalSamples() ?? null), [project, loaded, l]);

  // The player, once the video element exists.
  useEffect(() => {
    if (!video.current || !loaded) return;
    const p = new PreviewPlayer(
      video.current,
      (outTime, sourceTime) => useEditorUi.getState().set({ outTime, sourceTime }),
      () => useEditorUi.getState().set({ playing: false }),
    );
    player.current = p;
    return () => p.dispose();
  }, [loaded?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // An edit while playing restarts playback with the new edit, from where it was.
  useEffect(() => {
    const p = player.current;
    if (!p || !l || !project || !p.playing) return;
    void p.play(l, project, p.position(), extras());
  }, [project, l]);

  const togglePlay = useCallback(() => {
    const p = player.current;
    if (!p || !l || !project) return;
    if (p.playing) {
      p.stop();
      ui.set({ playing: false });
    } else {
      ui.set({ playing: true });
      void p.play(l, project, useEditorUi.getState().outTime, extras());
    }
  }, [l, project, ui]);

  /** Jumps to an original time: inside a removed section, to the next part that's kept. */
  const seekSource = useCallback(
    (t: number) => {
      if (!l || !player.current) return;
      let out = toOutput(l, t);
      if (out === null) {
        const next = l.segments.find((s) => s.start >= t);
        out = next ? next.outStart : l.duration;
      }
      if (player.current.playing) void player.current.play(l, project!, out, extras());
      else void player.current.seek(l, out);
    },
    [l, project],
  );

  const seekOutput = useCallback(
    (out: number) => {
      if (!l || !player.current) return;
      if (player.current.playing) void player.current.play(l, project!, out, extras());
      else void player.current.seek(l, out);
    },
    [l, project, extras],
  );

  /** An imported file becomes a track; as the voice, it also switches the recording's sound off, in one undo step. */
  const importFile = useCallback(
    async (file: File, kind: "music" | "voice") => {
      if (!loaded) return;
      const { assetId, buffer } = await importAudio(loaded.rec.id, file, loaded.info.hasAudio ? loaded.info.sampleRate : 48000);
      const t = newTrack(assetId, file.name, 0, buffer.duration, kind);
      change((p) => {
        const withTrack = addTrack(t)(p);
        return kind === "voice" ? setOriginal({ on: false })(withTrack) : withTrack;
      });
      useEditorUi.getState().set({ mode: "edited", selectedTrack: t.id, panel: "audio" });
    },
    [loaded, change],
  );

  const sel = ui.selection;
  const act = useCallback(
    (what: "remove" | "mute" | "text" | "highlight") => {
      if (!sel || !project) return;
      if (what === "remove") change(removeSection(sel, duration));
      if (what === "mute") change(muteSection(sel, duration));
      if (what === "text" || what === "highlight") {
        const o = what === "text" ? newText(sel) : newHighlight(sel);
        change(addOverlay(o));
        // Straight to its settings, so the new text can be typed at once.
        ui.set({ selectedOverlay: o.id, panel: "overlays" });
      }
      if (what === "remove") ui.set({ selection: null });
    },
    [sel, project, change, duration, ui],
  );

  // Keys: Space, I/O, Delete, undo and redo. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod) return;
      const u = useEditorUi.getState();
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // A frame; with Shift a millisecond; with Alt one audio sample.
        e.preventDefault();
        const rate = player.current?.originalSamples()?.rate ?? 48000;
        const dt = (e.altKey ? 1 / rate : e.shiftKey ? 0.001 : 1 / 30) * (e.key === "ArrowLeft" ? -1 : 1);
        seekSource(Math.min(duration, Math.max(0, u.sourceTime + dt)));
      } else if (e.key === "[" || e.key === "]") {
        const t = u.sourceTime;
        const s = u.selection;
        if (e.key === "[") u.set({ selection: { start: t, end: s && s.end > t ? s.end : Math.min(duration, t + 0.001) } });
        else u.set({ selection: { start: s && s.start < t ? s.start : Math.max(0, t - 0.001), end: t } });
      } else if (e.key === "i" || e.key === "o") {
        const t = u.sourceTime;
        const s = u.selection ?? { start: t, end: Math.min(duration, t + 1) };
        u.set({ selection: e.key === "i" ? { start: t, end: Math.max(t + 0.05, s.end) } : { start: Math.min(s.start, t - 0.05), end: t } });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (u.selection) act("remove");
        else if (u.selectedOverlay) {
          change(deleteOverlay(u.selectedOverlay));
          u.set({ selectedOverlay: null });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, undo, redo, duration, act, change, seekSource]);

  const previewJoin = async (i: number) => {
    if (!l || !loaded || !project || !worker) return;
    const at = l.segments[i + 1]!.outStart;
    setJoinPreview({ busy: true });
    try {
      const name = `join-preview-${Date.now()}.${loaded.info.output!.container}`;
      await worker.export({ file: loaded.source, project, fileName: name, dir: TEMP_DIR, audioOnly: false, range: { from: at - 1.5, to: at + l.joins[i]!.crossfade + 1.5 }, audio: exportAudio() });
      const f = await (await (await outputDir(TEMP_DIR)).getFileHandle(name)).getFile();
      setJoinPreview({ url: URL.createObjectURL(f), name });
    } catch {
      setJoinPreview(null);
    }
  };
  const closeJoinPreview = () => {
    if (joinPreview && "url" in joinPreview) {
      URL.revokeObjectURL(joinPreview.url);
      void outputDir(TEMP_DIR).then((d) => d.removeEntry(joinPreview.name)).catch(() => undefined);
    }
    setJoinPreview(null);
  };

  if (error)
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3" data-testid="editor-error">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link to="/" className="text-sm text-primary hover:underline">Back to dashboard</Link>
      </main>
    );
  if (!loaded || !project || !l || !worker) return <main className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="editor-loading">Opening the recording…</main>;

  const nothingLeft = l.duration <= 0;
  return (
    <TooltipProvider delayDuration={300}>
      <main className="flex h-full flex-col bg-background" data-testid="editor" data-duration={l.duration.toFixed(3)}>
        <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="editor-back"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
          <h1 className="ml-2 min-w-0 flex-1 truncate text-sm font-medium">Editing: {loaded.rec.title}</h1>
          <Button size="icon-sm" variant="ghost" onClick={undo} disabled={!canUndo()} aria-label="Undo" data-testid="editor-undo"><Undo2 /></Button>
          <Button size="icon-sm" variant="ghost" onClick={redo} disabled={!canRedo()} aria-label="Redo" data-testid="editor-redo"><Redo2 /></Button>
          <Button size="sm" variant="ghost" onClick={() => change(() => ({ ...newEditProject({ id: loaded.rec.id, durationMs: duration * 1000 }), updatedAt: project.updatedAt }))} data-testid="editor-revert"><RotateCcw /> Revert all</Button>
          <Button size="sm" onClick={() => setExporting("video")} disabled={nothingLeft} title={nothingLeft ? "Everything is removed" : undefined} data-testid="editor-export"><Download /> Export</Button>
        </header>
        {/* minmax(0, 1fr): a plain 1fr column grows to fit the timeline canvas, which then grows to fit it. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-3 p-3">
          <section className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="min-h-0 flex-1">
              <Preview ref={video} src={loaded.url} width={loaded.info.width} height={loaded.info.height} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={togglePlay} aria-label={ui.playing ? "Pause" : "Play"} data-testid="editor-play">{ui.playing ? <Pause /> : <Play />}</Button>
              <span className="font-mono text-xs text-muted-foreground" data-testid="editor-time">{fmt(ui.outTime)} / {fmt(l.duration)}</span>
              <span className="flex-1" />
              <SelectionBar duration={duration} onAct={act} />
            </div>
            <TimelineView duration={duration} layout={l} peaks={loaded.peaks} peaksPerSecond={PEAKS_PER_SECOND} samples={player.current?.originalSamples() ?? null} trackBuffer={cachedAsset} onSeekSource={seekSource} onSeekOutput={seekOutput} />
            <p className="text-xs text-muted-foreground">Space plays · drag on the timeline to select · I and O set the selection at the playhead · Delete removes it · ⌘Z undoes</p>
          </section>
          <aside className="panel min-h-0 overflow-hidden p-3"><Panels duration={duration} layout={l} info={loaded.info} onPreviewJoin={(i) => void previewJoin(i)} onAudioOnly={() => setExporting("audio")} samples={player.current?.originalSamples() ?? null} onImport={importFile} onJump={seekSource} /></aside>
        </div>
        <ExportDialog open={exporting !== null} onClose={() => setExporting(null)} worker={worker} buildAudio={exportAudio} source={loaded.source} original={loaded.rec} project={project} info={loaded.info} audioOnly={exporting === "audio"} />
        <Dialog open={joinPreview !== null} onOpenChange={(o) => !o && closeJoinPreview()}>
          <DialogContent data-testid="editor-join-preview">
            <DialogHeader><DialogTitle>Join, as exported</DialogTitle></DialogHeader>
            {joinPreview && "url" in joinPreview ? <video src={joinPreview.url} controls autoPlay className="aspect-video w-full rounded-md bg-black" /> : <p className="text-sm text-muted-foreground">Rendering…</p>}
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}

/** The selected range, editable to the hundredth of a second, and what to do with it. */
function SelectionBar({ duration, onAct }: { duration: number; onAct: (w: "remove" | "mute" | "text" | "highlight") => void }) {
  const { selection, set } = useEditorUi();
  const field = (k: "start" | "end") => (
    <Input
      type="number"
      step="any"
      min={0}
      max={duration}
      className="h-7 w-28 px-1 font-mono text-xs"
      value={selection ? String(+selection[k].toFixed(6)) : ""}
      placeholder={k === "start" ? "from" : "to"}
      aria-label={k === "start" ? "Selection start, seconds" : "Selection end, seconds"}
      data-testid={`editor-sel-${k}`}
      onChange={(e) => {
        const v = Math.min(duration, Math.max(0, Number(e.target.value)));
        const s = selection ?? { start: 0, end: 0 };
        const next = { ...s, [k]: v };
        set({ selection: next.end > next.start ? next : { start: Math.min(next.start, next.end), end: Math.max(next.start, next.end) } });
      }}
    />
  );
  // Any length at all: a single audio sample is a valid thing to remove.
  const none = !selection || selection.end - selection.start <= 0;
  return (
    <div className="flex items-center gap-1" data-testid="editor-selection">
      {field("start")}
      <span className="text-xs text-muted-foreground">–</span>
      {field("end")}
      <span className="w-20 font-mono text-[11px] text-muted-foreground" data-testid="editor-sel-length">{selection ? `${((selection.end - selection.start) * 1000).toFixed(selection.end - selection.start < 0.01 ? 3 : 1)} ms` : ""}</span>
      <Button size="sm" variant="secondary" disabled={none} onClick={() => onAct("remove")} data-testid="editor-remove"><Scissors /> Remove</Button>
      <Button size="sm" variant="ghost" disabled={none} onClick={() => onAct("mute")} data-testid="editor-mute"><VolumeX /> Mute</Button>
      <Button size="sm" variant="ghost" disabled={none} onClick={() => onAct("text")} data-testid="editor-add-text"><Type /> Text</Button>
      <Button size="sm" variant="ghost" disabled={none} onClick={() => onAct("highlight")} data-testid="editor-add-highlight"><Highlighter /> Highlight</Button>
    </div>
  );
}

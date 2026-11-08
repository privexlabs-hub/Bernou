/** The editor's side panel: cuts, audio, text and highlights, picture. */
import { useMemo, useRef, useState } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { Input } from "@/ui/input";
import type { AddedTrack, TimeRange } from "@/db/dexie";
import { findSilences, suggestThreshold } from "./silences";
import { OVERLAY_COLORS, type Overlay, type TextOverlay } from "@/db/dexie";
import { Button } from "@/ui/button";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Textarea } from "@/ui/textarea";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { cn } from "@/lib/utils";
import { deleteOverlay, deleteTrack, restoreSection, setOriginal, unmuteSection, updateOverlay, updateTrack } from "./edits";
import { OFFSET_MS, OVERLAY_TEXT_MAX, PICTURE_RANGE, VOLUME_DB } from "./project";
import { CROSSFADE_S, keptSegments, MIN_SMOOTH_CUT_S, normalizeRanges, type Layout } from "./timeline";
import type { SourceInfo } from "./export/protocol";

export const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

export interface PanelsProps {
  duration: number;
  layout: Layout;
  info: SourceInfo;
  onPreviewJoin: (joinIndex: number) => void;
  onAudioOnly: () => void;
  /** The decoded recording sound, mono, for finding silences. */
  samples: { samples: Float32Array; rate: number } | null;
  /** Adds an imported file as music, or as the voice in place of the recording's. Throws a message to show. */
  onImport: (file: File, kind: "music" | "voice") => Promise<void>;
  onJump: (sourceTime: number) => void;
}

export function Panels({ duration, layout, info, onPreviewJoin, onAudioOnly, samples, onImport, onJump }: PanelsProps) {
  const panel = useEditorUi((s) => s.panel);
  const setUi = useEditorUi((s) => s.set);
  return (
    <Tabs value={panel} onValueChange={(v) => setUi({ panel: v as typeof panel })} className="flex h-full flex-col">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="cuts" data-testid="editor-tab-cuts">Cuts</TabsTrigger>
        <TabsTrigger value="silences" data-testid="editor-tab-silences">Silence</TabsTrigger>
        <TabsTrigger value="audio" data-testid="editor-tab-audio">Audio</TabsTrigger>
        <TabsTrigger value="overlays" data-testid="editor-tab-overlays">Text</TabsTrigger>
        <TabsTrigger value="picture" data-testid="editor-tab-picture">Picture</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3 text-sm">
        <TabsContent value="cuts"><CutsPanel duration={duration} layout={layout} onPreviewJoin={onPreviewJoin} /></TabsContent>
        <TabsContent value="silences"><SilencesPanel duration={duration} samples={samples} onJump={onJump} /></TabsContent>
        <TabsContent value="audio"><AudioPanel duration={duration} info={info} onAudioOnly={onAudioOnly} onImport={onImport} /></TabsContent>
        <TabsContent value="overlays"><OverlaysPanel /></TabsContent>
        <TabsContent value="picture"><PicturePanel /></TabsContent>
      </div>
    </Tabs>
  );
}

function CutsPanel({ duration, layout, onPreviewJoin }: { duration: number; layout: Layout; onPreviewJoin: (i: number) => void }) {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const cuts = normalizeRanges(p.cuts, duration);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Select a range on the timeline, then remove it. Drag the orange handles to trim the start and end.</p>
      <ul className="space-y-1" data-testid="editor-cuts">
        {cuts.length === 0 && <li className="text-xs text-muted-foreground">Nothing removed.</li>}
        {cuts.map((c) => (
          <li key={`${c.start}`} className="flex items-center justify-between rounded border border-border/70 px-2 py-1" data-testid="editor-cut">
            <span className="font-mono text-xs">{fmt(c.start)} – {fmt(c.end)} <span className="text-muted-foreground">({(c.end - c.start).toFixed(2)} s)</span></span>
            <Button size="sm" variant="ghost" onClick={() => change(restoreSection(c, duration))} data-testid="editor-cut-restore"><Undo2 /> Restore</Button>
          </li>
        ))}
      </ul>
      <label className="flex items-center justify-between gap-2">
        <span>Smooth joins <span className="text-xs text-muted-foreground">({CROSSFADE_S} s crossfade where at least {MIN_SMOOTH_CUT_S} s was cut; smaller cuts stay sharp)</span></span>
        <Switch checked={p.smoothJoins} onCheckedChange={(c) => change((x) => ({ ...x, smoothJoins: c }))} data-testid="editor-smooth-joins" aria-label="Smooth joins" />
      </label>
      {p.smoothJoins && layout.joins.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">The preview shows joins as a cut. To see a crossfade exactly as it will be exported, render it:</p>
          {layout.joins.map((_, i) => (
            <Button key={i} size="sm" variant="secondary" onClick={() => onPreviewJoin(i)} data-testid="editor-preview-join">Preview join {i + 1}</Button>
          ))}
        </div>
      )}
    </div>
  );
}

function AudioPanel({ duration, info, onAudioOnly, onImport }: { duration: number; info: SourceInfo; onAudioOnly: () => void; onImport: PanelsProps["onImport"] }) {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const a = p.audio;
  const mutes = normalizeRanges(a.mutes, duration);
  return (
    <div className="space-y-6">
      {info.hasAudio ? <RecordingSound /> : <p className="text-xs text-muted-foreground" data-testid="editor-no-audio">This recording has no sound of its own.</p>}
      {info.hasAudio && a.original.on && (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex justify-between"><span>Volume</span><span className="font-mono text-xs" data-testid="editor-volume-value">{a.volumeDb > 0 ? "+" : ""}{a.volumeDb} dB</span></div>
        <Slider min={VOLUME_DB.min} max={VOLUME_DB.max} step={1} value={[a.volumeDb]} onValueChange={([v]) => v !== undefined && change((x) => ({ ...x, audio: { ...x.audio, volumeDb: v } }), "volume")} aria-label="Volume" data-testid="editor-volume" />
      </div>
      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2">
          <span>Reduce background noise</span>
          <Switch checked={a.denoise.on} disabled={!!info.denoiseUnavailable} onCheckedChange={(c) => change((x) => ({ ...x, audio: { ...x.audio, denoise: { ...x.audio.denoise, on: c } } }))} data-testid="editor-denoise" aria-label="Reduce background noise" />
        </label>
        {info.denoiseUnavailable && <p className="text-xs text-muted-foreground">{info.denoiseUnavailable}</p>}
        <p className="text-xs text-muted-foreground">A speech model running on this computer: removes steady noise like air, fans and traffic. Strong settings can thin your voice; listen before exporting.</p>
        {a.denoise.on && (
          <div className="space-y-1">
            <div className="flex justify-between"><span className="text-xs">Strength</span><span className="font-mono text-xs">{Math.round(a.denoise.strength * 100)}%</span></div>
            <Slider min={10} max={100} step={5} value={[Math.round(a.denoise.strength * 100)]} onValueChange={([v]) => v !== undefined && change((x) => ({ ...x, audio: { ...x.audio, denoise: { ...x.audio.denoise, strength: v / 100 } } }), "denoise-strength")} aria-label="Noise removal strength" data-testid="editor-denoise-strength" />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <span>Muted sections</span>
        <ul className="space-y-1" data-testid="editor-mutes">
          {mutes.length === 0 && <li className="text-xs text-muted-foreground">Select a range on the timeline, then Mute section.</li>}
          {mutes.map((m) => (
            <li key={m.start} className="flex items-center justify-between rounded border border-border/70 px-2 py-1">
              <span className="font-mono text-xs">{fmt(m.start)} – {fmt(m.end)}</span>
              <Button size="sm" variant="ghost" onClick={() => change(unmuteSection(m, duration))}><Undo2 /> Unmute</Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
      )}
      <AddedAudio onImport={onImport} />
      <Button variant="secondary" onClick={onAudioOnly} data-testid="editor-audio-only">Download audio only (WAV)</Button>
    </div>
  );
}

/** The recording's own sound, detached: on or off, and shifted against the picture. */
function RecordingSound() {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const o = p.audio.original;
  const nudge = (ms: number) => change(setOriginal({ offsetMs: Math.max(-OFFSET_MS, Math.min(OFFSET_MS, Math.round((o.offsetMs + ms) * 1000) / 1000)) }), "offset");
  return (
    <section className="space-y-2" data-testid="editor-recording-sound">
      <label className="flex items-center justify-between gap-2 font-medium">
        <span>Recording sound</span>
        <Switch checked={o.on} onCheckedChange={(c) => change(setOriginal({ on: c }))} aria-label="Recording sound on" data-testid="editor-original-on" />
      </label>
      {!o.on && <p className="text-xs text-muted-foreground">Off: the export has none of the recording's sound.</p>}
      <div className="flex items-center gap-1">
        <span className="text-xs">Shift</span>
        <Input type="number" step="any" min={-OFFSET_MS} max={OFFSET_MS} className="h-7 w-24 px-1 font-mono text-xs" value={o.offsetMs} onChange={(e) => change(setOriginal({ offsetMs: Math.max(-OFFSET_MS, Math.min(OFFSET_MS, Number(e.target.value) || 0)) }), "offset")} aria-label="Shift the recording's sound, milliseconds" data-testid="editor-original-offset" />
        <span className="text-xs text-muted-foreground">ms</span>
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => nudge(-1000 / 30)} title="A frame earlier">−1f</Button>
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => nudge(-1)} title="1 ms earlier">−1</Button>
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => nudge(1)} title="1 ms later">+1</Button>
        <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => nudge(1000 / 30)} title="A frame later">+1f</Button>
      </div>
      <p className="text-xs text-muted-foreground">Positive plays the sound later against the picture, to fix lip sync.</p>
    </section>
  );
}

/** Imported audio: music under the voice, or a voice in place of the recording's. */
function AddedAudio({ onImport }: { onImport: PanelsProps["onImport"] }) {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const { selectedTrack, set } = useEditorUi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const music = useRef<HTMLInputElement>(null);
  const voice = useRef<HTMLInputElement>(null);
  const tracks = p.audio.tracks;
  const sel = tracks.find((t) => t.id === selectedTrack) ?? null;
  const pick = async (file: File | undefined, kind: "music" | "voice") => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await onImport(file, kind);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" data-testid="editor-added-audio">
      <span className="font-medium">Added audio</span>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => music.current?.click()} data-testid="editor-add-audio">Add audio</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => voice.current?.click()} data-testid="editor-replace-voice">Replace voice with a file</Button>
        <input ref={music} type="file" accept="audio/*" className="hidden" data-testid="editor-add-audio-input" onChange={(e) => void pick(e.target.files?.[0], "music").finally(() => (e.target.value = ""))} />
        <input ref={voice} type="file" accept="audio/*" className="hidden" data-testid="editor-replace-voice-input" onChange={(e) => void pick(e.target.files?.[0], "voice").finally(() => (e.target.value = ""))} />
      </div>
      {busy && <p className="text-xs text-muted-foreground">Reading the file…</p>}
      {error && <p className="text-xs text-destructive" role="alert" data-testid="editor-audio-error">{error}</p>}
      <ul className="space-y-1" data-testid="editor-tracks">
        {tracks.length === 0 && <li className="text-xs text-muted-foreground">Music, a re-recorded voice: it goes on the final video, so cuts don't chop it. Placed in the Edited view of the timeline.</li>}
        {tracks.map((t) => (
          <li key={t.id}>
            <button type="button" className={cn("flex w-full items-center justify-between rounded border px-2 py-1 text-left", t.id === selectedTrack ? "border-primary" : "border-border/70")} onClick={() => set({ selectedTrack: t.id, mode: "edited" })} data-testid="editor-track-item">
              <span className="truncate">{t.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{fmt(t.start)}</span>
            </button>
          </li>
        ))}
      </ul>
      {sel && <TrackEditor key={sel.id} trackId={sel.id} />}
      {tracks.some((t) => t.duck) && (
        <div className="space-y-1">
          <div className="flex justify-between"><span className="text-xs">Dip while someone speaks</span><span className="font-mono text-xs" data-testid="editor-duck-depth-value">{p.audio.ducking.depthDb} dB</span></div>
          <Slider min={-30} max={-3} step={1} value={[p.audio.ducking.depthDb]} onValueChange={([v]) => v !== undefined && change((x) => ({ ...x, audio: { ...x.audio, ducking: { depthDb: v } } }), "duck-depth")} aria-label="How far music dips while someone speaks" data-testid="editor-duck-depth" />
        </div>
      )}
    </section>
  );
}

function TrackEditor({ trackId }: { trackId: string }) {
  const t = useEditorStore((s) => s.project!.audio.tracks.find((x) => x.id === trackId))!;
  const change = useEditorStore((s) => s.change);
  const { set } = useEditorUi();
  const upd = (patch: Partial<AddedTrack>, key?: string) => change(updateTrack(t.id, patch), key && `${key}:${t.id}`);
  const num = (label: string, value: number, onChange: (v: number) => void, testId: string) => (
    <label className="flex items-center justify-between gap-2 text-xs">
      {label}
      <Input type="number" step="any" min={0} className="h-7 w-24 px-1 font-mono text-xs" value={+value.toFixed(3)} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} data-testid={testId} />
    </label>
  );
  return (
    <div className="space-y-3 rounded-md border border-border/70 p-3" data-testid="editor-track-editor">
      {num("Starts at (s)", t.start, (v) => upd({ start: v }, "start"), "editor-track-start")}
      {num("From (s into the file)", t.trimIn, (v) => upd({ trimIn: v }, "trimIn"), "editor-track-trim")}
      <div className="space-y-1">
        <div className="flex justify-between text-xs"><span>Volume</span><span className="font-mono" data-testid="editor-track-volume-value">{t.volumeDb} dB</span></div>
        <Slider min={-40} max={12} step={1} value={[t.volumeDb]} onValueChange={([v]) => v !== undefined && upd({ volumeDb: v }, "volume")} aria-label="Track volume" data-testid="editor-track-volume" />
      </div>
      {(["fadeIn", "fadeOut"] as const).map((k) => (
        <div key={k} className="space-y-1">
          <div className="flex justify-between text-xs"><span>{k === "fadeIn" ? "Fade in" : "Fade out"}</span><span className="font-mono">{t[k].toFixed(1)} s</span></div>
          <Slider min={0} max={5} step={0.1} value={[t[k]]} onValueChange={([v]) => v !== undefined && upd({ [k]: v }, k)} aria-label={k === "fadeIn" ? "Fade in" : "Fade out"} data-testid={`editor-track-${k}`} />
        </div>
      ))}
      <label className="flex items-center justify-between gap-2 text-xs">Loop to fill the video <Switch checked={t.loop} onCheckedChange={(c) => upd({ loop: c })} aria-label="Loop" data-testid="editor-track-loop" /></label>
      <label className="flex items-center justify-between gap-2 text-xs">Lower while someone speaks <Switch checked={t.duck} onCheckedChange={(c) => upd({ duck: c })} aria-label="Lower while someone speaks" data-testid="editor-track-duck" /></label>
      <label className="flex items-center justify-between gap-2 text-xs">This is a voice <Switch checked={t.voice} onCheckedChange={(c) => upd({ voice: c })} aria-label="This is a voice: music dips under it" data-testid="editor-track-voice" /></label>
      <Button size="sm" variant="ghost" onClick={() => { change(deleteTrack(t.id)); set({ selectedTrack: null }); }} data-testid="editor-track-delete"><Trash2 /> Remove</Button>
    </div>
  );
}

/** Finds silent stretches in the recording's sound, to review and remove. */
function SilencesPanel({ duration, samples, onJump }: { duration: number; samples: PanelsProps["samples"]; onJump: (t: number) => void }) {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const { silences, set } = useEditorUi();
  const suggested = useMemo(() => (samples ? suggestThreshold(samples.samples, samples.rate) : -40), [samples]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [minDuration, setMinDuration] = useState(0.5);
  const [keep, setKeep] = useState(0.15);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [found, setFound] = useState(false);
  const db = threshold ?? suggested;
  if (!samples) return <p className="text-xs text-muted-foreground">{p.audio.original.on ? "Reading the recording's sound…" : "The recording's sound is off."}</p>;

  const find = () => {
    const all = findSilences(samples.samples, samples.rate, { thresholdDb: db, minDuration, keep, offset: p.audio.original.offsetMs / 1000 });
    // Only what's still in the edit: the parts of each silence inside what's kept.
    const kept = keptSegments({ duration, trim: p.trim, cuts: p.cuts, smoothJoins: false });
    const list = all.flatMap((s) => kept.map((k) => ({ start: Math.max(s.start, k.start), end: Math.min(s.end, k.end) })).filter((r) => r.end - r.start >= 0.01));
    set({ silences: list });
    setChosen(new Set(list.map((_, i) => i)));
    setFound(true);
  };
  const remove = (ranges: TimeRange[]) => {
    if (ranges.length === 0) return;
    change((x) => ({ ...x, cuts: normalizeRanges([...x.cuts, ...ranges], duration) }));
    set({ silences: [] });
    setFound(false);
  };
  const row = (label: string, value: string, slider: React.ReactNode) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span>{label}</span><span className="font-mono">{value}</span></div>
      {slider}
    </div>
  );
  const total = silences.reduce((n, s) => n + s.end - s.start, 0);
  return (
    <div className="space-y-4" data-testid="editor-silences">
      <p className="text-xs text-muted-foreground">Finds stretches quieter than the threshold, keeping a natural pause at each end. Review them on the timeline (yellow), then remove all or some: one undo puts them all back.</p>
      {row("Quieter than", `${db} dB${threshold === null ? " (suggested)" : ""}`, <Slider min={-70} max={-15} step={1} value={[db]} onValueChange={([v]) => v !== undefined && setThreshold(v)} aria-label="Silence threshold" data-testid="editor-silence-threshold" />)}
      {row("For at least", `${minDuration.toFixed(1)} s`, <Slider min={0.1} max={3} step={0.1} value={[minDuration]} onValueChange={([v]) => v !== undefined && setMinDuration(v)} aria-label="Shortest silence" data-testid="editor-silence-min" />)}
      {row("Pause to keep", `${keep.toFixed(2)} s`, <Slider min={0} max={0.5} step={0.05} value={[keep]} onValueChange={([v]) => v !== undefined && setKeep(v)} aria-label="Pause to keep at each end" data-testid="editor-silence-keep" />)}
      <Button size="sm" onClick={find} data-testid="editor-silence-find">Find silences</Button>
      {found && (
        <div className="space-y-2">
          <p className="text-xs" data-testid="editor-silence-summary">{silences.length === 0 ? "No silences found with these settings." : `${silences.length} found, ${total.toFixed(1)} s in all.`}</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto" data-testid="editor-silence-list">
            {silences.map((s, i) => (
              <li key={`${s.start}`} className="flex items-center gap-2 rounded border border-border/70 px-2 py-1" data-testid="editor-silence-item">
                <input type="checkbox" checked={chosen.has(i)} onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(i); else n.delete(i); return n; })} aria-label={`Remove the silence at ${fmt(s.start)}`} />
                <button type="button" className="flex-1 text-left font-mono text-xs" onClick={() => onJump(s.start)}>{fmt(s.start)} · {((s.end - s.start) * 1000).toFixed(0)} ms</button>
              </li>
            ))}
          </ul>
          {silences.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={chosen.size === 0} onClick={() => remove(silences.filter((_, i) => chosen.has(i)))} data-testid="editor-silence-remove-selected">Remove selected</Button>
              <Button size="sm" onClick={() => remove(silences)} data-testid="editor-silence-remove-all">Remove all</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OverlaysPanel() {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const { selectedOverlay, set } = useEditorUi();
  const sel = p.overlays.find((o) => o.id === selectedOverlay) ?? null;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Select a range on the timeline, then Add text or Add highlight. Drag them on the video to place them; the corner resizes.</p>
      <ul className="space-y-1" data-testid="editor-overlays">
        {p.overlays.length === 0 && <li className="text-xs text-muted-foreground">No text or highlights yet.</li>}
        {p.overlays.map((o) => (
          <li key={o.id}>
            <button type="button" className={cn("flex w-full items-center justify-between rounded border px-2 py-1 text-left", o.id === selectedOverlay ? "border-primary" : "border-border/70")} onClick={() => set({ selectedOverlay: o.id })} data-testid="editor-overlay-item">
              <span className="truncate">{o.kind === "text" ? o.text : "Highlight"}</span>
              <span className="font-mono text-xs text-muted-foreground">{fmt(o.start)}–{fmt(o.end)}</span>
            </button>
          </li>
        ))}
      </ul>
      {sel && <OverlayEditor o={sel} onChange={(patch, key) => change(updateOverlay(sel.id, patch), key)} onDelete={() => { change(deleteOverlay(sel.id)); set({ selectedOverlay: null }); }} />}
    </div>
  );
}

function OverlayEditor({ o, onChange, onDelete }: { o: Overlay; onChange: (p: Partial<Overlay>, key?: string) => void; onDelete: () => void }) {
  return (
    <div className="space-y-3 rounded-md border border-border/70 p-3" data-testid="editor-overlay-editor">
      {o.kind === "text" ? (
        <>
          <Textarea value={o.text} maxLength={OVERLAY_TEXT_MAX} rows={2} onChange={(e) => onChange({ text: e.target.value } as Partial<TextOverlay>, `text:${o.id}`)} aria-label="Text" data-testid="editor-overlay-text" />
          <div className="flex gap-1">
            {(["s", "m", "l"] as const).map((s) => (
              <Button key={s} size="sm" variant={o.size === s ? "secondary" : "ghost"} onClick={() => onChange({ size: s } as Partial<TextOverlay>)}>{s.toUpperCase()}</Button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs">Box <Switch checked={o.box} onCheckedChange={(c) => onChange({ box: c } as Partial<TextOverlay>)} aria-label="Backing box" /></label>
          </div>
        </>
      ) : (
        <div className="flex gap-1">
          {(["outline", "fill"] as const).map((s) => (
            <Button key={s} size="sm" variant={o.style === s ? "secondary" : "ghost"} onClick={() => onChange({ style: s } as Partial<Overlay>)}>{s === "outline" ? "Outline" : "Soft fill"}</Button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5" role="radiogroup" aria-label="Colour">
        {OVERLAY_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={o.color === c} aria-label={`Colour ${c}`} onClick={() => onChange({ color: c })} className={cn("h-6 w-6 rounded-full border-2", o.color === c ? "border-primary" : "border-border")} style={{ background: c }} />
        ))}
      </div>
      <Button size="sm" variant="ghost" onClick={onDelete} data-testid="editor-overlay-delete"><Trash2 /> Delete</Button>
    </div>
  );
}

function PicturePanel() {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const rows = [["brightness", "Brightness"], ["contrast", "Contrast"], ["saturation", "Saturation"]] as const;
  return (
    <div className="space-y-5">
      {rows.map(([k, label]) => (
        <div key={k} className="space-y-1">
          <div className="flex justify-between"><span>{label}</span><span className="font-mono text-xs" data-testid={`editor-${k}-value`}>{p.picture[k] > 0 ? "+" : ""}{p.picture[k]}</span></div>
          <Slider min={-PICTURE_RANGE} max={PICTURE_RANGE} step={1} value={[p.picture[k]]} onValueChange={([v]) => v !== undefined && change((x) => ({ ...x, picture: { ...x.picture, [k]: v } }), k)} aria-label={label} data-testid={`editor-${k}`} />
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => change((x) => ({ ...x, picture: { brightness: 0, contrast: 0, saturation: 0 } }))} data-testid="editor-picture-reset">Reset</Button>
    </div>
  );
}

/** The editor's side panel: cuts, audio, text and highlights, picture. */
import { Trash2, Undo2 } from "lucide-react";
import { OVERLAY_COLORS, type Overlay, type TextOverlay } from "@/db/dexie";
import { Button } from "@/ui/button";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Textarea } from "@/ui/textarea";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { cn } from "@/lib/utils";
import { deleteOverlay, restoreSection, unmuteSection, updateOverlay } from "./edits";
import { OVERLAY_TEXT_MAX, PICTURE_RANGE, VOLUME_DB } from "./project";
import { CROSSFADE_S, normalizeRanges, type Layout } from "./timeline";
import type { SourceInfo } from "./export/protocol";

export const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

export function Panels({ duration, layout, info, onPreviewJoin, onAudioOnly }: { duration: number; layout: Layout; info: SourceInfo; onPreviewJoin: (joinIndex: number) => void; onAudioOnly: () => void }) {
  const panel = useEditorUi((s) => s.panel);
  const setUi = useEditorUi((s) => s.set);
  return (
    <Tabs value={panel} onValueChange={(v) => setUi({ panel: v as typeof panel })} className="flex h-full flex-col">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="cuts" data-testid="editor-tab-cuts">Cuts</TabsTrigger>
        <TabsTrigger value="audio" data-testid="editor-tab-audio">Audio</TabsTrigger>
        <TabsTrigger value="overlays" data-testid="editor-tab-overlays">Text</TabsTrigger>
        <TabsTrigger value="picture" data-testid="editor-tab-picture">Picture</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto pt-3 text-sm">
        <TabsContent value="cuts"><CutsPanel duration={duration} layout={layout} onPreviewJoin={onPreviewJoin} /></TabsContent>
        <TabsContent value="audio"><AudioPanel duration={duration} info={info} onAudioOnly={onAudioOnly} /></TabsContent>
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
        <span>Smooth joins <span className="text-xs text-muted-foreground">({CROSSFADE_S} s crossfade)</span></span>
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

function AudioPanel({ duration, info, onAudioOnly }: { duration: number; info: SourceInfo; onAudioOnly: () => void }) {
  const p = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  if (!info.hasAudio) return <p className="text-xs text-muted-foreground" data-testid="editor-no-audio">This recording has no sound.</p>;
  const a = p.audio;
  const mutes = normalizeRanges(a.mutes, duration);
  return (
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
      <Button variant="secondary" onClick={onAudioOnly} data-testid="editor-audio-only">Download audio only (WAV)</Button>
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

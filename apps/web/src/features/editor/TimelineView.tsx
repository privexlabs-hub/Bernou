/**
 * The timeline. Two views:
 * - Original: the recording's own time, with removed sections hatched, for
 *   selecting and cutting (the only place to cut, so a selection is always in
 *   the original's time).
 * - Edited: the final result's time, with the added audio rows to place and trim.
 * Both zoom from the whole recording down to 5 ms, where single samples show.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, ScanSearch } from "lucide-react";
import type { AddedTrack, Overlay, TimeRange } from "@/db/dexie";
import { Button } from "@/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { normalizeRanges, sourcesAt, type Layout } from "./timeline";
import { setTrim, updateOverlay, updateTrack } from "./edits";
import { fit, scroll, ticks, zoomAt, zoomTo, type ViewWindow } from "./viewWindow";

const RULER_H = 18;
const WAVE_H = 72;
const BAR_ROW = 22;
const TRACK_ROW = 30;
const HANDLE_PX = 7;

type Drag =
  | { kind: "select"; from: number; x0: number }
  | { kind: "trim"; edge: "start" | "end" }
  | { kind: "overlay"; id: string; mode: "move" | "start" | "end"; t0: number; orig: TimeRange }
  | { kind: "track"; id: string; mode: "move" | "start" | "end"; t0: number; orig: AddedTrack; x0: number };

export interface TimelineProps {
  duration: number;
  layout: Layout;
  peaks: Float32Array | null;
  peaksPerSecond: number;
  /** The decoded recording sound, mono, or null while it's decoding. */
  samples: { samples: Float32Array; rate: number } | null;
  trackBuffer: (assetId: string) => AudioBuffer | null;
  onSeekSource: (t: number) => void;
  onSeekOutput: (t: number) => void;
}

export function TimelineView({ duration, layout, peaks, peaksPerSecond, samples, trackBuffer, onSeekSource, onSeekOutput }: TimelineProps) {
  const project = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const ui = useEditorUi();
  const { selection, sourceTime, outTime, selectedOverlay, mode, silences, selectedTrack, set } = ui;
  const edited = mode === "edited";
  const span = edited ? layout.duration : duration;
  const win: ViewWindow = (edited ? ui.outView : ui.view) ?? fit(span);
  const setWin = useCallback((w: ViewWindow) => set(edited ? { outView: w } : { view: w }), [edited, set]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Partial<{ trim: TimeRange; overlay: Overlay; track: AddedTrack }>>({});
  const tracks = project.audio.tracks.map((t) => (preview.track && t.id === preview.track.id ? preview.track : t));
  const height = RULER_H + WAVE_H + (edited ? tracks.length * TRACK_ROW : BAR_ROW) + 8;
  const offset = project.audio.original.offsetMs / 1000;

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const x = useCallback((t: number) => ((t - win.start) / (win.end - win.start)) * width, [win, width]);
  const tAt = useCallback((px: number) => Math.min(span, Math.max(0, win.start + (px / width) * (win.end - win.start))), [win, width, span]);

  // The playhead stays in view while playing.
  const head = edited ? outTime : sourceTime;
  useEffect(() => {
    if (ui.playing && (head < win.start || head > win.end)) setWin(scroll(win, head - win.start - (win.end - win.start) * 0.1, span));
  }, [head, ui.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The recording sound's level range over the original-time span [a, b): from peaks when zoomed out, else from the samples. */
  const levelRange = useCallback(
    (a: number, b: number): [number, number] => {
      const sa = a - offset;
      const sb = b - offset;
      // Closer than the peaks' resolution (10 ms a pixel): the actual samples.
      if (samples && b - a < 1 / peaksPerSecond) {
        const i0 = Math.max(0, Math.floor(sa * samples.rate));
        const i1 = Math.min(samples.samples.length, Math.max(i0 + 1, Math.ceil(sb * samples.rate)));
        let lo = 0;
        let hi = 0;
        for (let i = i0; i < i1; i++) {
          const v = samples.samples[i]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        return [lo, hi];
      }
      if (!peaks) return [0, 0];
      let m = 0;
      for (let i = Math.max(0, Math.floor(sa * peaksPerSecond)); i < Math.min(peaks.length, Math.max(Math.floor(sa * peaksPerSecond) + 1, Math.floor(sb * peaksPerSecond))); i++) m = Math.max(m, peaks[i]!);
      return [-m, m];
    },
    [samples, peaks, peaksPerSecond, offset],
  );

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const trim = preview.trim ?? project.trim;
    const overlays = project.overlays.map((o) => (preview.overlay && o.id === preview.overlay.id ? preview.overlay : o));
    const pxSpan = (win.end - win.start) / width;

    // Ruler
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, 0, width, RULER_H);
    ctx.fillStyle = "#9aa3b2";
    ctx.font = "10px ui-monospace, monospace";
    for (const tk of ticks(win, width)) {
      const px = x(tk.t);
      ctx.fillRect(px, RULER_H - 6, 1, 6);
      ctx.fillText(tk.label, px + 3, 11);
    }
    const y0 = RULER_H;

    // The recording's sound
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, y0, width, WAVE_H);
    const mid = y0 + WAVE_H / 2;
    const amp = (v: number) => Math.max(-1, Math.min(1, v * 1.6)) * (WAVE_H / 2 - 2);
    ctx.fillStyle = project.audio.original.on ? "#7c8597" : "#3b4150";
    const sampleView = samples && pxSpan * samples.rate < 1;
    if (sampleView && !edited) {
      // Closer than one sample per pixel: the samples themselves, as a line with dots.
      const i0 = Math.max(0, Math.floor((win.start - offset) * samples.rate));
      const i1 = Math.min(samples.samples.length - 1, Math.ceil((win.end - offset) * samples.rate));
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const px = x(i / samples.rate + offset);
        const py = mid - amp(samples.samples[i]!);
        if (i === i0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      for (let i = i0; i <= i1; i++) ctx.fillRect(x(i / samples.rate + offset) - 1.5, mid - amp(samples.samples[i]!) - 1.5, 3, 3);
    } else {
      for (let px = 0; px < width; px++) {
        const t = win.start + px * pxSpan;
        let a = t;
        let b = t + pxSpan;
        if (edited) {
          // Output time to the original's, for the part of the recording heard there.
          const s = sourcesAt(layout, t);
          if (s.length === 0) continue;
          a = s[s.length - 1]!.t;
          b = a + pxSpan;
        }
        const [lo, hi] = levelRange(a, b);
        const top = mid - amp(hi);
        const bottom = mid - amp(lo);
        ctx.fillRect(px, Math.min(top, mid - 0.5), 1, Math.max(1, bottom - top));
      }
    }

    if (!edited) {
      // Silences found
      ctx.fillStyle = "rgba(234,179,8,0.25)";
      for (const s of silences) ctx.fillRect(x(s.start), y0, x(s.end) - x(s.start), WAVE_H);
      // Mutes
      ctx.fillStyle = "rgba(239,68,68,0.28)";
      for (const m of normalizeRanges(project.audio.mutes, duration)) ctx.fillRect(x(m.start), y0, x(m.end) - x(m.start), WAVE_H);
      // Removed: outside the trim, and every cut
      for (const r of normalizeRanges([...project.cuts, { start: 0, end: trim.start }, { start: trim.end, end: duration }], duration)) hatch(ctx, x(r.start), y0, x(r.end) - x(r.start), WAVE_H);
      // Trim handles
      ctx.fillStyle = "#f59e0b";
      for (const t of [trim.start, trim.end]) ctx.fillRect(x(t) - 2, y0, 4, WAVE_H);
      // Selection
      if (selection) {
        ctx.fillStyle = "rgba(59,130,246,0.25)";
        const sx = x(selection.start);
        const sw = Math.max(1, x(selection.end) - sx);
        ctx.fillRect(sx, y0, sw, WAVE_H);
        ctx.strokeStyle = "#3b82f6";
        ctx.strokeRect(sx + 0.5, y0 + 0.5, sw - 1, WAVE_H - 1);
      }
      // Overlays
      const by = y0 + WAVE_H + 4;
      for (const o of [...overlays].sort((a, b) => Number(a.id === selectedOverlay) - Number(b.id === selectedOverlay))) {
        const sel = o.id === selectedOverlay;
        ctx.fillStyle = o.kind === "text" ? (sel ? "#3b82f6" : "rgba(59,130,246,0.55)") : sel ? "#f59e0b" : "rgba(245,158,11,0.55)";
        ctx.fillRect(x(o.start), by, Math.max(3, x(o.end) - x(o.start)), BAR_ROW - 4);
        ctx.fillStyle = "#0b0d12";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(o.kind === "text" ? o.text.slice(0, 40) : "Highlight", x(o.start) + 4, by + 13, Math.max(0, x(o.end) - x(o.start) - 8));
      }
    } else {
      // Added audio rows
      tracks.forEach((t, i) => {
        const ty = y0 + WAVE_H + 4 + i * TRACK_ROW;
        const end = t.loop ? layout.duration : Math.min(layout.duration, t.start + t.length);
        const sel = t.id === selectedTrack;
        ctx.fillStyle = sel ? "rgba(34,197,94,0.45)" : "rgba(34,197,94,0.25)";
        ctx.fillRect(x(t.start), ty, Math.max(3, x(end) - x(t.start)), TRACK_ROW - 6);
        const buf = trackBuffer(t.assetId);
        if (buf && t.length > 0) {
          const d = buf.getChannelData(0);
          ctx.fillStyle = "#22c55e";
          const tm = ty + (TRACK_ROW - 6) / 2;
          for (let px = Math.max(0, Math.floor(x(t.start))); px < Math.min(width, x(end)); px++) {
            const tt = win.start + px * pxSpan;
            const a = Math.floor((t.trimIn + ((tt - t.start) % t.length)) * buf.sampleRate);
            const b = Math.max(a + 1, Math.floor(a + pxSpan * buf.sampleRate));
            let m = 0;
            for (let k = a; k < b && k < d.length; k += Math.max(1, Math.floor((b - a) / 64))) m = Math.max(m, Math.abs(d[k]!));
            const hh = Math.max(1, Math.min(1, m * 1.6) * ((TRACK_ROW - 6) / 2 - 1));
            ctx.fillRect(px, tm - hh, 1, hh * 2);
          }
        }
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(`${t.name}${t.voice ? " · voice" : ""}${t.duck ? " · dips" : ""}`, x(t.start) + 4, ty + 12, Math.max(0, x(end) - x(t.start) - 8));
      });
    }
    // Playhead
    ctx.fillStyle = "#f4f4f5";
    ctx.fillRect(x(head) - 1, 0, 2, height);
  }, [project, preview, selection, selectedOverlay, selectedTrack, head, peaks, peaksPerSecond, samples, width, height, duration, x, win, edited, silences, tracks, layout, trackBuffer, levelRange, offset]);

  const overlayAt = (px: number, py: number) => {
    if (py < RULER_H + WAVE_H + 2) return null;
    const hits = project.overlays.filter((o) => px >= x(o.start) - HANDLE_PX && px <= x(o.end) + HANDLE_PX);
    return hits.find((o) => o.id === selectedOverlay) ?? hits[hits.length - 1] ?? null;
  };
  const trackAt = (px: number, py: number) => {
    const row = Math.floor((py - RULER_H - WAVE_H - 4) / TRACK_ROW);
    const t = tracks[row];
    if (!t) return null;
    const end = t.loop ? layout.duration : t.start + t.length;
    return px >= x(t.start) - HANDLE_PX && px <= x(end) + HANDLE_PX ? t : null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (e.ctrlKey || e.metaKey) {
      // Zoom around the pointer; a trackpad pinch arrives as this.
      setWin(zoomAt(win, tAt(px), Math.exp(e.deltaY * 0.01), span));
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setWin(scroll(win, (d / width) * (win.end - win.start), span));
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (edited) {
      const t = trackAt(px, py);
      if (t) {
        set({ selectedTrack: t.id, panel: "audio" });
        const end = t.loop ? layout.duration : t.start + t.length;
        const m = Math.abs(px - x(t.start)) <= HANDLE_PX ? "start" : !t.loop && Math.abs(px - x(end)) <= HANDLE_PX ? "end" : "move";
        drag.current = { kind: "track", id: t.id, mode: m, t0: tAt(px), orig: t, x0: px };
      } else drag.current = { kind: "select", from: tAt(px), x0: px };
      return;
    }
    const o = overlayAt(px, py);
    if (o) {
      set({ selectedOverlay: o.id });
      const m = Math.abs(px - x(o.start)) <= HANDLE_PX ? "start" : Math.abs(px - x(o.end)) <= HANDLE_PX ? "end" : "move";
      drag.current = { kind: "overlay", id: o.id, mode: m, t0: tAt(px), orig: { start: o.start, end: o.end } };
      return;
    }
    for (const edge of ["start", "end"] as const) {
      if (py >= RULER_H && py < RULER_H + WAVE_H && Math.abs(px - x(project.trim[edge])) <= HANDLE_PX) {
        drag.current = { kind: "trim", edge };
        return;
      }
    }
    drag.current = { kind: "select", from: tAt(px), x0: px };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const t = tAt(px);
    if (d.kind === "select") {
      if (!edited && Math.abs(px - d.x0) >= 3) set({ selection: { start: Math.min(d.from, t), end: Math.max(d.from, t) } });
    } else if (d.kind === "trim") {
      const trim = { ...project.trim };
      if (d.edge === "start") trim.start = Math.min(t, trim.end - 0.001);
      else trim.end = Math.max(t, trim.start + 0.001);
      setPreview({ trim });
    } else if (d.kind === "overlay") {
      const o = project.overlays.find((v) => v.id === d.id);
      if (!o) return;
      const dt = t - d.t0;
      const len = d.orig.end - d.orig.start;
      const range =
        d.mode === "move"
          ? { start: Math.min(duration - len, Math.max(0, d.orig.start + dt)), end: 0 }
          : d.mode === "start"
            ? { start: Math.min(d.orig.end - 0.1, Math.max(0, d.orig.start + dt)), end: d.orig.end }
            : { start: d.orig.start, end: Math.max(d.orig.start + 0.1, Math.min(duration, d.orig.end + dt)) };
      if (d.mode === "move") range.end = range.start + len;
      setPreview({ overlay: { ...o, ...range } as Overlay });
    } else {
      const dt = t - d.t0;
      const o = d.orig;
      const fileLen = trackBuffer(o.assetId)?.duration ?? o.trimIn + o.length;
      let next: AddedTrack;
      if (d.mode === "move") next = { ...o, start: Math.max(0, o.start + dt) };
      else if (d.mode === "start") {
        // Trimming the front: start later in the file as well as later on the video.
        const shift = Math.min(o.length - 0.01, Math.max(-o.trimIn, dt, -o.start));
        next = { ...o, start: o.start + shift, trimIn: o.trimIn + shift, length: o.length - shift };
      } else next = { ...o, length: Math.max(0.01, Math.min(fileLen - o.trimIn, o.length + dt)) };
      setPreview({ track: next });
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (d.kind === "select" && Math.abs(px - d.x0) < 3) {
      if (!edited) set({ selection: null });
      if (edited) onSeekOutput(tAt(px));
      else onSeekSource(tAt(px));
    }
    if (d.kind === "trim" && preview.trim) change(setTrim(preview.trim));
    if (d.kind === "overlay" && preview.overlay) change(updateOverlay(d.id, { start: preview.overlay.start, end: preview.overlay.end }));
    if (d.kind === "track" && preview.track) change(updateTrack(d.id, { start: preview.track.start, trimIn: preview.track.trimIn, length: preview.track.length }));
    setPreview({});
  };

  const zoomBy = (f: number) => setWin(zoomAt(win, head >= win.start && head <= win.end ? head : (win.start + win.end) / 2, f, span));
  const winSpan = win.end - win.start;
  return (
    <div className="w-full min-w-0 select-none space-y-1 overflow-hidden">
      <div className="flex items-center gap-1">
        <Tabs value={mode} onValueChange={(v) => set({ mode: v as "original" | "edited" })}>
          <TabsList className="h-7">
            <TabsTrigger value="original" className="h-6 px-2 text-xs" data-testid="editor-view-original">Original</TabsTrigger>
            <TabsTrigger value="edited" className="h-6 px-2 text-xs" data-testid="editor-view-edited">Edited</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[11px] text-muted-foreground">{edited ? "The final video: place added audio here." : "Select and cut here."}</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="editor-zoom-span">{winSpan >= 1 ? `${winSpan.toFixed(1)} s` : `${(winSpan * 1000).toFixed(winSpan < 0.01 ? 1 : 0)} ms`} shown</span>
        <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(1 / 2)} aria-label="Zoom in" title="Zoom in (Ctrl/⌘ + wheel)" data-testid="editor-zoom-in"><Plus /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(2)} aria-label="Zoom out" title="Zoom out" data-testid="editor-zoom-out"><Minus /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setWin(fit(span))} aria-label="Fit" title="Show everything" data-testid="editor-zoom-fit"><Maximize2 /></Button>
        <Button size="icon-sm" variant="ghost" disabled={edited || !selection} onClick={() => selection && setWin(zoomTo(selection, span))} aria-label="Zoom to selection" title="Zoom to the selection" data-testid="editor-zoom-selection"><ScanSearch /></Button>
      </div>
      <canvas
        ref={canvas}
        style={{ width, height, touchAction: "none", cursor: "crosshair" }}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          setPreview({});
        }}
        aria-label="Timeline: drag to select a range; Ctrl or ⌘ and the wheel to zoom"
        data-testid="editor-timeline"
        data-view-start={win.start}
        data-view-end={win.end}
      />
    </div>
  );
}

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (w <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = "rgba(11,13,18,0.7)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(244,244,245,0.25)";
  ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 8) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

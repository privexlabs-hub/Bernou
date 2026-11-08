/**
 * The timeline, as tracks.
 * - Original view: the recording's own time, with removed parts closed up at
 *   a red seam (click it to put the part back), or shown hatched. A video row
 *   (thumbnails), the sound row below it (its waveform, detected gaps, a strip
 *   to shift it, and a button to mute all of it), and overlay bars. Selecting
 *   and cutting happen here; clicking a gap on the sound row deletes it.
 * - Edited view: the final result's time, with the added audio rows.
 * Both zoom from the whole recording down to 5 ms, where single samples show.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, RotateCcw, ScanSearch, Volume2, VolumeX, X } from "lucide-react";
import type { AddedTrack, Overlay, TimeRange } from "@/db/dexie";
import { Button } from "@/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { normalizeRanges, sourcesAt, type Layout } from "./timeline";
import { removeSection, restoreSection, setOriginal, setTrim, updateOverlay, updateTrack } from "./edits";
import { collapse, collapsedTicks, fromDisplay, isRemoved, seams as seamsOf, toDisplay } from "./collapse";
import { OFFSET_MS } from "./project";
import { fit, scroll, ticks, zoomAt, zoomTo, type ViewWindow } from "./viewWindow";

const HANDLE_PX = 7;
const SEAM_PX = 5;
/** How near a gap's end the pointer must be to drag it shorter, and how wide a gap must be drawn to have ends to drag. */
const GAP_EDGE_PX = 6;
const GAP_MIN_PX = 4 * GAP_EDGE_PX;
const SHIFT_STRIP = 12;

interface Row {
  y: number;
  h: number;
}
/** Every row's place, in one spot, for drawing and for hit tests alike. */
function rowsFor(edited: boolean, trackCount: number) {
  const ruler: Row = { y: 0, h: 18 };
  if (edited) {
    const sound: Row = { y: 18, h: 72 };
    const tracks = Array.from({ length: trackCount }, (_, i): Row => ({ y: 18 + 72 + 4 + i * 30, h: 24 }));
    return { ruler, video: null, sound, overlays: null, tracks, height: 18 + 72 + 4 + trackCount * 30 + 4 };
  }
  const video: Row = { y: 18, h: 54 };
  const sound: Row = { y: 18 + 54 + 2, h: 72 };
  const overlays: Row = { y: sound.y + sound.h + 4, h: 18 };
  return { ruler, video, sound, overlays, tracks: [] as Row[], height: overlays.y + overlays.h + 4 };
}
const inRow = (r: Row | null, py: number) => !!r && py >= r.y && py < r.y + r.h;

type Drag =
  | { kind: "select"; from: number; x0: number; row: "ruler" | "video" | "sound" | "other"; moved: boolean; pointer: string }
  | { kind: "shift"; x0: number; orig: number }
  | { kind: "gap"; gap: TimeRange; edge: "start" | "end"; x0: number; moved: boolean }
  | { kind: "trim"; edge: "start" | "end" }
  | { kind: "overlay"; id: string; mode: "move" | "start" | "end"; t0: number; orig: TimeRange }
  | { kind: "track"; id: string; mode: "move" | "start" | "end"; t0: number; orig: AddedTrack };

export interface TimelineProps {
  duration: number;
  layout: Layout;
  peaks: Float32Array | null;
  peaksPerSecond: number;
  /** The decoded recording sound, mono, or null while it's decoding. */
  samples: { samples: Float32Array; rate: number } | null;
  trackBuffer: (assetId: string) => AudioBuffer | null;
  thumbs: { times: number[]; bitmaps: ImageBitmap[] };
  thumbsVersion: number;
  onSeekSource: (t: number) => void;
  onSeekOutput: (t: number) => void;
  onRemoveGap: (gap: TimeRange) => void;
}

export function TimelineView({ duration, layout, peaks, peaksPerSecond, samples, trackBuffer, thumbs, thumbsVersion, onSeekSource, onSeekOutput, onRemoveGap }: TimelineProps) {
  const project = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const mode = useEditorUi((s) => s.mode);
  const selection = useEditorUi((s) => s.selection);
  const sourceTime = useEditorUi((s) => s.sourceTime);
  const outTime = useEditorUi((s) => s.outTime);
  const playing = useEditorUi((s) => s.playing);
  const selectedOverlay = useEditorUi((s) => s.selectedOverlay);
  const selectedTrack = useEditorUi((s) => s.selectedTrack);
  const silences = useEditorUi((s) => s.silences);
  const hoverSilence = useEditorUi((s) => s.hoverSilence);
  const view = useEditorUi((s) => s.view);
  const outView = useEditorUi((s) => s.outView);
  const set = useEditorUi((s) => s.set);
  const showRemoved = useEditorUi((s) => s.showRemoved);
  const edited = mode === "edited";
  // Original view: positions are the recording's time less what's removed before it.
  const col = useMemo(() => collapse(project.cuts, duration, edited || showRemoved), [project.cuts, duration, edited, showRemoved]);
  const closedUp = !edited && !showRemoved;
  const span = edited ? layout.duration : col.span;
  // Kept inside the timeline when it gets shorter (a cut) or longer (an undo).
  const win: ViewWindow = scroll((edited ? outView : view) ?? fit(span), 0, span);
  const setWin = useCallback((w: ViewWindow) => set(edited ? { outView: w } : { view: w }), [edited, set]);
  const base = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<Drag | null>(null);
  const hover = useRef<number | null>(null);
  /** On touch, the gap tapped once, waiting for a second tap to delete it. */
  const armed = useRef<number | null>(null);
  /** The seam under the pointer, and the one clicked open, by index in the removed parts. */
  const [hoverSeam, setHoverSeam] = useState<number | null>(null);
  const [openSeam, setOpenSeam] = useState<number | null>(null);
  useEffect(() => setOpenSeam(null), [project.cuts, closedUp]);
  const [preview, setPreview] = useState<Partial<{ trim: TimeRange; overlay: Overlay; track: AddedTrack; offsetMs: number; gapCut: TimeRange }>>({});
  const tracks = project.audio.tracks.map((t) => (preview.track && t.id === preview.track.id ? preview.track : t));
  const rows = useMemo(() => rowsFor(edited, tracks.length), [edited, tracks.length]);
  const offsetMs = preview.offsetMs ?? project.audio.original.offsetMs;
  const offset = offsetMs / 1000;
  const muted = !project.audio.original.on;

  useEffect(() => {
    const el = base.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** A timeline position to pixels. */
  const xd = useCallback((d: number) => ((d - win.start) / (win.end - win.start)) * width, [win, width]);
  /** The view's own time (the recording's in Original, the output's in Edited) to a timeline position. */
  const D = useCallback((t: number) => (edited ? t : toDisplay(col, t)), [edited, col]);
  const x = useCallback((t: number) => xd(D(t)), [xd, D]);
  const dAt = useCallback((px: number) => Math.min(span, Math.max(0, win.start + (px / width) * (win.end - win.start))), [win, width, span]);
  /** Pixels to the view's own time. */
  const tAt = useCallback((px: number) => (edited ? dAt(px) : Math.min(duration, fromDisplay(col, dAt(px)))), [edited, dAt, col, duration]);

  // While playing, the view turns the page when the playhead runs off it, unless
  // you've scrolled away to look elsewhere: then it stays put until the playhead
  // is back in view (a click to seek there, or playing on into it).
  const head = edited ? outTime : sourceTime;
  const headD = D(head);
  const follow = useRef(true);
  const scrollTo = useCallback(
    (w: ViewWindow) => {
      follow.current = false;
      setWin(w);
    },
    [setWin],
  );
  useEffect(() => {
    if (!playing) return;
    if (headD >= win.start && headD <= win.end) follow.current = true;
    else if (follow.current) setWin(scroll(win, headD - win.start - (win.end - win.start) * 0.1, span));
  }, [head, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (playing) follow.current = true;
  }, [playing]);

  /** The recording sound's level range over the original-time span [a, b), in its own (shifted) time. */
  const levelRange = useCallback(
    (a: number, b: number): [number, number] => {
      const sa = a - offset;
      const sb = b - offset;
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
      const p0 = Math.max(0, Math.floor(sa * peaksPerSecond));
      const p1 = Math.min(peaks.length, Math.max(p0 + 1, Math.floor(sb * peaksPerSecond)));
      for (let i = p0; i < p1; i++) m = Math.max(m, peaks[i]!);
      return [-m, m];
    },
    [samples, peaks, peaksPerSecond, offset],
  );

  const sizeCanvas = (c: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(rows.height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(rows.height * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, rows.height);
    return ctx;
  };

  // The static layer: redrawn when the edit, the view or the data change, not on every playhead tick.
  useEffect(() => {
    const c = base.current;
    if (!c) return;
    const ctx = sizeCanvas(c);
    const trim = preview.trim ?? project.trim;
    const overlays = project.overlays.map((o) => (preview.overlay && o.id === preview.overlay.id ? preview.overlay : o));
    const pxSpan = (win.end - win.start) / width;

    // Ruler
    ctx.fillStyle = "#0f1117";
    ctx.fillRect(0, rows.ruler.y, width, rows.ruler.h);
    ctx.fillStyle = "#9aa3b2";
    ctx.font = "10px ui-monospace, monospace";
    // Labels in the view's own time; in Original, they jump at a seam as the time does.
    let lastLabel = -Infinity;
    for (const tk of edited ? ticks(win, width).map((k) => ({ d: k.t, label: k.label })) : collapsedTicks(col, win, width, duration)) {
      const px = xd(tk.d);
      ctx.fillRect(px, rows.ruler.h - 6, 1, 6);
      if (px - lastLabel < 48) continue;
      ctx.fillText(tk.label, px + 3, 11);
      lastLabel = px;
    }

    // Video row: thumbnails, the frame on screen at each slot's start
    if (rows.video) {
      const v = rows.video;
      ctx.fillStyle = "#111318";
      ctx.fillRect(0, v.y, width, v.h);
      const slot = Math.max(24, Math.round((v.h * 16) / 9));
      const { times, bitmaps } = thumbs;
      for (let px = 0; px < width && times.length; px += slot) {
        const t = tAt(px);
        // The last thumbnail at or before t.
        let lo = 0;
        let hi = times.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (times[mid]! <= t) lo = mid;
          else hi = mid - 1;
        }
        const bm = bitmaps[lo];
        if (bm) ctx.drawImage(bm, px, v.y, slot, v.h);
      }
      // Picture-only cuts: black
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      for (const b of project.blanks) ctx.fillRect(x(b.start), v.y, x(b.end) - x(b.start), v.h);
    }

    // Sound row
    const s = rows.sound;
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, s.y, width, s.h);
    const mid = s.y + SHIFT_STRIP / 2 + s.h / 2;
    const half = (s.h - SHIFT_STRIP) / 2 - 2;
    const amp = (val: number) => Math.max(-1, Math.min(1, val * 1.6)) * half;
    ctx.fillStyle = muted ? "#3b4150" : "#7c8597";
    if (!edited && samples && pxSpan * samples.rate < 1) {
      // Closer than one sample per pixel: the samples themselves, as a line with dots.
      // Removed samples are skipped, and the line breaks at a seam.
      const i0 = Math.max(0, Math.floor((fromDisplay(col, win.start) - offset) * samples.rate));
      const i1 = Math.min(samples.samples.length - 1, Math.ceil((fromDisplay(col, win.end) - offset) * samples.rate));
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.beginPath();
      let pen = false;
      for (let i = i0; i <= i1; i++) {
        const t = i / samples.rate + offset;
        if (isRemoved(col, t)) {
          pen = false;
          continue;
        }
        const px = x(t);
        const py = mid - amp(samples.samples[i]!);
        if (pen) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        pen = true;
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
      ctx.stroke();
    } else {
      for (let px = 0; px < width; px++) {
        let a = win.start + px * pxSpan;
        if (!edited) a = fromDisplay(col, a);
        else {
          const src = sourcesAt(layout, a);
          if (src.length === 0) continue;
          a = src[src.length - 1]!.t;
        }
        const [lo, hi] = levelRange(a, a + pxSpan);
        const yTop = mid - amp(hi);
        ctx.fillRect(px, Math.min(yTop, mid - 0.5), 1, Math.max(1, mid - amp(lo) - yTop));
      }
    }
    // The shift strip, along the top of the sound row
    ctx.fillStyle = "rgba(148,163,184,0.18)";
    ctx.fillRect(0, s.y, width, SHIFT_STRIP);
    ctx.fillStyle = "#9aa3b2";
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillText(offsetMs === 0 ? "⇔ drag to shift the sound" : `⇔ shifted ${offsetMs > 0 ? "+" : ""}${offsetMs.toFixed(1)} ms`, 6, s.y + 9);

    if (!edited) {
      // Gaps found
      ctx.fillStyle = "rgba(234,179,8,0.22)";
      for (const g of silences) ctx.fillRect(x(g.start), s.y + SHIFT_STRIP, x(g.end) - x(g.start), s.h - SHIFT_STRIP);
      // A gap being dragged shorter: the part that will go
      const gc = preview.gapCut;
      const dg = drag.current?.kind === "gap" ? drag.current.gap : null;
      if (gc && dg) {
        hatch(ctx, x(gc.start), s.y + SHIFT_STRIP, x(gc.end) - x(gc.start), s.h - SHIFT_STRIP);
        const left = `${fmtLen(Math.max(0, dg.end - dg.start - (gc.end - gc.start)))} left`;
        ctx.font = "600 11px system-ui, sans-serif";
        const w = ctx.measureText(left).width + 10;
        const lx = Math.min(width - w - 2, Math.max(2, x(dg.start)));
        ctx.fillStyle = "#eab308";
        ctx.fillRect(lx, s.y + s.h - 18, w, 16);
        ctx.fillStyle = "#0b0d12";
        ctx.fillText(left, lx + 5, s.y + s.h - 6);
      }
      // Deleted sound (mutes)
      ctx.fillStyle = "rgba(239,68,68,0.28)";
      for (const m of normalizeRanges(project.audio.mutes, duration)) ctx.fillRect(x(m.start), s.y + SHIFT_STRIP, x(m.end) - x(m.start), s.h - SHIFT_STRIP);
      // Removed: outside the trim, and every cut, across both rows
      const top = rows.video!.y;
      const h = s.y + s.h - top;
      for (const r of normalizeRanges([...(closedUp ? [] : project.cuts), { start: 0, end: trim.start }, { start: trim.end, end: duration }], duration)) hatch(ctx, x(r.start), top, x(r.end) - x(r.start), h);
      // Removed parts, closed up: a seam where each was
      seamsOf(col).forEach((sm, i) => {
        const sx = xd(sm.at);
        ctx.fillStyle = i === openSeam ? "#f87171" : "#ef4444";
        ctx.fillRect(sx - 1, top, 2, h);
        ctx.beginPath();
        ctx.moveTo(sx - 5, rows.ruler.h);
        ctx.lineTo(sx + 5, rows.ruler.h);
        ctx.lineTo(sx, rows.ruler.h + 6);
        ctx.fill();
      });
      // Trim handles
      ctx.fillStyle = "#f59e0b";
      for (const t of [trim.start, trim.end]) ctx.fillRect(x(t) - 2, top, 4, h);
      // Selection, across both rows
      if (selection) {
        const sx = x(selection.start);
        const sw = Math.max(1, x(selection.end) - sx);
        ctx.fillStyle = "rgba(59,130,246,0.25)";
        ctx.fillRect(sx, top, sw, h);
        ctx.strokeStyle = "#3b82f6";
        ctx.strokeRect(sx + 0.5, top + 0.5, sw - 1, h - 1);
      }
      // Overlays
      const by = rows.overlays!.y;
      for (const o of [...overlays].sort((a, b) => Number(a.id === selectedOverlay) - Number(b.id === selectedOverlay))) {
        const sel = o.id === selectedOverlay;
        ctx.fillStyle = o.kind === "text" ? (sel ? "#3b82f6" : "rgba(59,130,246,0.55)") : sel ? "#f59e0b" : "rgba(245,158,11,0.55)";
        ctx.fillRect(x(o.start), by, Math.max(3, x(o.end) - x(o.start)), rows.overlays!.h);
        ctx.fillStyle = "#0b0d12";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(o.kind === "text" ? o.text.slice(0, 40) : "Highlight", x(o.start) + 4, by + 13, Math.max(0, x(o.end) - x(o.start) - 8));
      }
    } else {
      tracks.forEach((t, i) => {
        const r = rows.tracks[i]!;
        const end = t.loop ? layout.duration : Math.min(layout.duration, t.start + t.length);
        ctx.fillStyle = t.id === selectedTrack ? "rgba(34,197,94,0.45)" : "rgba(34,197,94,0.25)";
        ctx.fillRect(x(t.start), r.y, Math.max(3, x(end) - x(t.start)), r.h);
        const buf = trackBuffer(t.assetId);
        if (buf && t.length > 0) {
          const d = buf.getChannelData(0);
          ctx.fillStyle = "#22c55e";
          const tm = r.y + r.h / 2;
          for (let px = Math.max(0, Math.floor(x(t.start))); px < Math.min(width, x(end)); px++) {
            const tt = win.start + px * pxSpan;
            const a = Math.floor((t.trimIn + ((tt - t.start) % t.length)) * buf.sampleRate);
            const b = Math.max(a + 1, Math.floor(a + pxSpan * buf.sampleRate));
            let m = 0;
            for (let k = a; k < b && k < d.length; k += Math.max(1, Math.floor((b - a) / 64))) m = Math.max(m, Math.abs(d[k]!));
            const hh = Math.max(1, Math.min(1, m * 1.6) * (r.h / 2 - 1));
            ctx.fillRect(px, tm - hh, 1, hh * 2);
          }
        }
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "11px system-ui, sans-serif";
        ctx.fillText(`${t.name}${t.voice ? " · voice" : ""}${t.duck ? " · dips" : ""}`, x(t.start) + 4, r.y + 12, Math.max(0, x(end) - x(t.start) - 8));
      });
    }
  }, [project, preview, selection, selectedOverlay, selectedTrack, peaks, peaksPerSecond, samples, width, rows, duration, x, tAt, win, edited, silences, tracks, layout, trackBuffer, levelRange, offset, offsetMs, muted, thumbsVersion, thumbs, col, closedUp, openSeam, xd]); // eslint-disable-line react-hooks/exhaustive-deps

  // The top layer: playhead, and the hovered gap with what a click will do.
  useEffect(() => {
    const c = top.current;
    if (!c) return;
    const ctx = sizeCanvas(c);
    const g = hoverSilence !== null ? silences[hoverSilence] : undefined;
    if (g && !edited) {
      const s = rows.sound;
      ctx.fillStyle = "rgba(234,179,8,0.45)";
      ctx.fillRect(x(g.start), s.y + SHIFT_STRIP, Math.max(2, x(g.end) - x(g.start)), s.h - SHIFT_STRIP);
      const label = `${armed.current === hoverSilence ? "Tap again" : "Click"} to delete ${(g.end - g.start).toFixed(1)} s gap${x(g.end) - x(g.start) >= GAP_MIN_PX ? " · drag an end to shorten it" : ""}`;
      ctx.font = "600 11px system-ui, sans-serif";
      const w = ctx.measureText(label).width + 10;
      const lx = Math.min(width - w - 2, Math.max(2, x(g.start)));
      ctx.fillStyle = "#eab308";
      ctx.fillRect(lx, s.y + SHIFT_STRIP + 2, w, 16);
      ctx.fillStyle = "#0b0d12";
      ctx.fillText(label, lx + 5, s.y + SHIFT_STRIP + 14);
    }
    const sm = hoverSeam !== null && openSeam === null ? seamsOf(col)[hoverSeam] : undefined;
    if (sm && rows.video) {
      const label = `${fmtLen(sm.cut.end - sm.cut.start)} removed · click to see or put back`;
      ctx.font = "600 11px system-ui, sans-serif";
      const w = ctx.measureText(label).width + 10;
      const lx = Math.min(width - w - 2, Math.max(2, xd(sm.at) + 4));
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(lx, rows.video.y + 2, w, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx + 5, rows.video.y + 14);
    }
    ctx.fillStyle = "#f4f4f5";
    ctx.fillRect(x(head) - 1, 0, 2, rows.height);
  }, [head, hoverSilence, silences, rows, x, xd, width, edited, hoverSeam, openSeam, col]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The gap under the pointer on the sound row, by index. */
  const gapAt = (px: number, py: number) => {
    if (edited || !inRow(rows.sound, py) || py < rows.sound.y + SHIFT_STRIP) return null;
    const t = tAt(px);
    const i = silences.findIndex((g) => t >= g.start && t < g.end);
    return i < 0 ? null : i;
  };
  /** The end of a gap under the pointer, for dragging it shorter. Only gaps wide enough on screen have ends to drag. */
  const gapEdgeAt = (px: number, py: number): { gap: TimeRange; edge: "start" | "end" } | null => {
    if (edited || !inRow(rows.sound, py) || py < rows.sound.y + SHIFT_STRIP) return null;
    for (const g of silences) {
      const a = x(g.start);
      const b = x(g.end);
      if (b - a < GAP_MIN_PX) continue;
      if (Math.abs(px - a) <= GAP_EDGE_PX) return { gap: g, edge: "start" };
      if (Math.abs(px - b) <= GAP_EDGE_PX) return { gap: g, edge: "end" };
    }
    return null;
  };
  /** The seam under the pointer, on the video or sound rows, by index. */
  const seamAt = (px: number, py: number) => {
    if (!closedUp || !(inRow(rows.video, py) || (inRow(rows.sound, py) && py >= rows.sound.y + SHIFT_STRIP))) return null;
    let best: number | null = null;
    seamsOf(col).forEach((sm, i) => {
      const dist = Math.abs(xd(sm.at) - px);
      if (dist <= SEAM_PX && (best === null || dist < Math.abs(xd(seamsOf(col)[best]!.at) - px))) best = i;
    });
    return best;
  };
  const setHover = (i: number | null) => {
    if (hover.current === i) return;
    hover.current = i;
    set({ hoverSilence: i });
  };

  const overlayAt = (px: number, py: number) => {
    if (!inRow(rows.overlays, py)) return null;
    const hits = project.overlays.filter((o) => px >= x(o.start) - HANDLE_PX && px <= x(o.end) + HANDLE_PX);
    return hits.find((o) => o.id === selectedOverlay) ?? hits[hits.length - 1] ?? null;
  };
  const trackAt = (px: number, py: number) => {
    const i = rows.tracks.findIndex((r) => inRow(r, py));
    const t = tracks[i];
    if (!t) return null;
    const end = t.loop ? layout.duration : t.start + t.length;
    return px >= x(t.start) - HANDLE_PX && px <= x(end) + HANDLE_PX ? t : null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (e.ctrlKey || e.metaKey) scrollTo(zoomAt(win, dAt(px), Math.exp(e.deltaY * 0.01), span));
    else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      scrollTo(scroll(win, (d / width) * (win.end - win.start), span));
    }
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    setOpenSeam(null);
    if (edited) {
      const t = trackAt(px, py);
      if (t) {
        set({ selectedTrack: t.id, panel: "audio" });
        const end = t.loop ? layout.duration : t.start + t.length;
        const m = Math.abs(px - x(t.start)) <= HANDLE_PX ? "start" : !t.loop && Math.abs(px - x(end)) <= HANDLE_PX ? "end" : "move";
        drag.current = { kind: "track", id: t.id, mode: m, t0: tAt(px), orig: t };
      } else drag.current = { kind: "select", from: tAt(px), x0: px, row: "other", moved: false, pointer: e.pointerType };
      return;
    }
    if (inRow(rows.sound, py) && py < rows.sound.y + SHIFT_STRIP) {
      drag.current = { kind: "shift", x0: px, orig: project.audio.original.offsetMs };
      return;
    }
    const o = overlayAt(px, py);
    if (o) {
      set({ selectedOverlay: o.id });
      const m = Math.abs(px - x(o.start)) <= HANDLE_PX ? "start" : Math.abs(px - x(o.end)) <= HANDLE_PX ? "end" : "move";
      drag.current = { kind: "overlay", id: o.id, mode: m, t0: tAt(px), orig: { start: o.start, end: o.end } };
      return;
    }
    // A gap's end, unless a seam is right there (seams win, as they're narrower).
    const ge = seamAt(px, py) === null ? gapEdgeAt(px, py) : null;
    if (ge) {
      drag.current = { kind: "gap", ...ge, x0: px, moved: false };
      setHover(null);
      return;
    }
    if (inRow(rows.video, py) || inRow(rows.sound, py)) {
      for (const edge of ["start", "end"] as const) {
        if (Math.abs(px - x(project.trim[edge])) <= HANDLE_PX) {
          drag.current = { kind: "trim", edge };
          return;
        }
      }
    }
    const row = inRow(rows.ruler, py) ? "ruler" : inRow(rows.video, py) ? "video" : inRow(rows.sound, py) ? "sound" : "other";
    drag.current = { kind: "select", from: tAt(px), x0: px, row, moved: false, pointer: e.pointerType };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const d = drag.current;
    if (!d) {
      // Hover: only mouse has it.
      if (e.pointerType === "mouse") {
        const sm = seamAt(px, py);
        setHoverSeam(sm);
        const i = sm === null ? gapAt(px, py) : null;
        setHover(i);
        e.currentTarget.style.cursor = sm === null && gapEdgeAt(px, py) ? "ew-resize" : i !== null || sm !== null ? "pointer" : inRow(rows.sound, py) && py < rows.sound.y + SHIFT_STRIP && !edited ? "ew-resize" : "crosshair";
      }
      return;
    }
    const t = tAt(px);
    if (d.kind === "select") {
      if (Math.abs(px - d.x0) >= 3) d.moved = true;
      if (!edited && d.moved) set({ selection: { start: Math.min(d.from, t), end: Math.max(d.from, t) } });
    } else if (d.kind === "gap") {
      if (Math.abs(px - d.x0) >= 3) d.moved = true;
      if (!d.moved) return;
      // From the dragged end to the pointer, never past the gap's other end.
      const at = Math.min(d.gap.end, Math.max(d.gap.start, t));
      setPreview({ gapCut: d.edge === "start" ? { start: d.gap.start, end: at } : { start: at, end: d.gap.end } });
    } else if (d.kind === "shift") {
      const ms = ((px - d.x0) / width) * (win.end - win.start) * 1000;
      setPreview({ offsetMs: Math.max(-OFFSET_MS, Math.min(OFFSET_MS, Math.round((d.orig + ms) * 10) / 10)) });
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
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (d.kind === "select" && !d.moved) {
      // A click, with no movement at all during the press.
      const seam = seamAt(px, py);
      const gap = seam === null && d.row === "sound" ? gapAt(px, py) : null;
      if (seam !== null) {
        setOpenSeam(seam);
        setHoverSeam(null);
      } else if (gap !== null) {
        if (d.pointer !== "mouse" && armed.current !== gap) {
          // Touch has no hover: the first tap shows what a second will do.
          armed.current = gap;
          setHover(gap);
          set({ hoverSilence: gap });
        } else {
          armed.current = null;
          setHover(null);
          onRemoveGap(silences[gap]!);
        }
      } else {
        armed.current = null;
        if (!edited) set({ selection: null });
        if (edited) onSeekOutput(tAt(px));
        else onSeekSource(tAt(px));
      }
    }
    if (d.kind === "gap") {
      const cut = preview.gapCut;
      if (!d.moved) {
        // A click on the end is a click on the gap.
        setHover(null);
        onRemoveGap(d.gap);
      } else if (cut && cut.end - cut.start >= 0.001) {
        const left = d.gap.end - d.gap.start - (cut.end - cut.start);
        change(removeSection(cut, duration));
        set({ status: left < 0.001 ? `Removed a ${fmtLen(d.gap.end - d.gap.start)} gap · ⌘Z to undo` : `Shortened a gap from ${fmtLen(d.gap.end - d.gap.start)} to ${fmtLen(left)} · ⌘Z to undo` });
      }
    }
    if (d.kind === "shift" && preview.offsetMs !== undefined) change(setOriginal({ offsetMs: preview.offsetMs }));
    if (d.kind === "trim" && preview.trim) change(setTrim(preview.trim));
    if (d.kind === "overlay" && preview.overlay) change(updateOverlay(d.id, { start: preview.overlay.start, end: preview.overlay.end }));
    if (d.kind === "track" && preview.track) change(updateTrack(d.id, { start: preview.track.start, trimIn: preview.track.trimIn, length: preview.track.length }));
    setPreview({});
  };

  const zoomBy = (f: number) => scrollTo(zoomAt(win, headD >= win.start && headD <= win.end ? headD : (win.start + win.end) / 2, f, span));
  const opened = openSeam !== null ? seamsOf(col)[openSeam] : undefined;
  const winSpan = win.end - win.start;
  const label = (r: Row | null, text: string, extra?: React.ReactNode) =>
    r && (
      <div className="absolute left-0 flex w-full items-center gap-1 px-1 text-[11px] text-muted-foreground" style={{ top: r.y, height: r.h }}>
        <span>{text}</span>
        {extra}
      </div>
    );
  return (
    <div className="w-full min-w-0 select-none space-y-1 overflow-hidden">
      <div className="flex items-center gap-1">
        <Tabs value={mode} onValueChange={(v) => set({ mode: v as "original" | "edited" })}>
          <TabsList className="h-7">
            <TabsTrigger value="original" className="h-6 px-2 text-xs" data-testid="editor-view-original">Original</TabsTrigger>
            <TabsTrigger value="edited" className="h-6 px-2 text-xs" data-testid="editor-view-edited">Edited</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[11px] text-muted-foreground">{edited ? "The final video: place added audio here." : `Drag to select · click a yellow gap to delete it${closedUp ? " · red seams: removed parts" : ""}`}</span>
        <span className="flex-1" />
        {!edited && project.cuts.length > 0 && (
          <Button
            size="sm"
            variant={showRemoved ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => set({ showRemoved: !showRemoved })}
            aria-pressed={showRemoved}
            title={showRemoved ? "Close up the removed parts again" : "Show the removed parts at full length, to adjust a cut's edges"}
            data-testid="editor-show-removed"
          >
            Show removed
          </Button>
        )}
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="editor-zoom-span">{winSpan >= 1 ? `${winSpan.toFixed(1)} s` : `${(winSpan * 1000).toFixed(winSpan < 0.01 ? 1 : 0)} ms`} shown</span>
        <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(1 / 2)} aria-label="Zoom in" title="Zoom in (Ctrl/⌘ + wheel)" data-testid="editor-zoom-in"><Plus /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => zoomBy(2)} aria-label="Zoom out" title="Zoom out" data-testid="editor-zoom-out"><Minus /></Button>
        <Button size="icon-sm" variant="ghost" onClick={() => scrollTo(fit(span))} aria-label="Fit" title="Show everything" data-testid="editor-zoom-fit"><Maximize2 /></Button>
        <Button size="icon-sm" variant="ghost" disabled={edited || !selection} onClick={() => selection && scrollTo(zoomTo({ start: D(selection.start), end: D(selection.end) }, span))} aria-label="Zoom to selection" title="Zoom to the selection" data-testid="editor-zoom-selection"><ScanSearch /></Button>
      </div>
      <div className="flex w-full min-w-0">
        {/* The row labels, outside the canvas, so time-to-x uses only the canvas width. */}
        <div className="relative w-16 shrink-0" style={{ height: rows.height }}>
          {label(rows.video, "Video")}
          {label(
            rows.sound,
            "Sound",
            <Button
              size="icon-sm"
              variant={muted ? "secondary" : "ghost"}
              className="h-6 w-6"
              onClick={() => change(setOriginal({ on: muted }))}
              aria-label={muted ? "Unmute the recording's sound" : "Mute all of the recording's sound"}
              aria-pressed={muted}
              title={muted ? "Muted: click to bring the sound back" : "Mute all of the recording's sound"}
              data-testid="editor-sound-mute"
            >
              {muted ? <VolumeX /> : <Volume2 />}
            </Button>,
          )}
          {edited && tracks.map((t, i) => label(rows.tracks[i]!, "Track"))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: rows.height }}>
          <canvas ref={base} className="absolute inset-0" style={{ width, height: rows.height }} aria-hidden />
          <canvas
            ref={top}
            className="absolute inset-0"
            style={{ width, height: rows.height, touchAction: "none", cursor: "crosshair" }}
            onWheel={onWheel}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => {
              setHover(null);
              setHoverSeam(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setPreview({});
            }}
            aria-label="Timeline: drag to select a range; click a highlighted gap to delete it; Ctrl or ⌘ and the wheel to zoom"
            id="editor-timeline"
            data-testid="editor-timeline"
            data-view-start={win.start}
            data-view-end={win.end}
            data-silences={silences.length}
            data-gaps={silences.map((g) => `${g.start.toFixed(4)}-${g.end.toFixed(4)}`).join(" ")}
            data-hover-silence={hoverSilence ?? ""}
            data-thumbs={thumbs.times.length}
            data-muted={muted ? "true" : "false"}
            data-span={span}
            data-seams={closedUp ? col.cuts.length : 0}
            data-sound-y={rows.sound.y}
            data-video-y={rows.video?.y ?? ""}
          />
          {opened && rows.video && (
            <div
              className="absolute z-10 flex items-center gap-1 rounded-md border border-red-500/60 bg-background/95 py-0.5 pl-2 pr-0.5 text-xs shadow-md"
              style={{ left: Math.min(Math.max(0, width - 240), Math.max(0, xd(opened.at) - 60)), top: rows.video.y + 2 }}
              data-testid="editor-seam"
            >
              <span>
                {fmtLen(opened.cut.end - opened.cut.start)} removed ({opened.cut.start.toFixed(2)}–{opened.cut.end.toFixed(2)} s)
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs"
                onClick={() => {
                  change(restoreSection(opened.cut, duration));
                  set({ status: `Put back ${fmtLen(opened.cut.end - opened.cut.start)} · ⌘Z to remove it again` });
                }}
                data-testid="editor-seam-restore"
              >
                <RotateCcw /> Put back
              </Button>
              <Button size="icon-sm" variant="ghost" className="h-6 w-6" onClick={() => setOpenSeam(null)} aria-label="Close">
                <X />
              </Button>
            </div>
          )}
        </div>
      </div>
      {winSpan < span - 1e-9 && (
        <div className="flex w-full min-w-0">
          <div className="w-16 shrink-0" />
          <ScrollBar win={win} span={span} onScroll={scrollTo} />
        </div>
      )}
    </div>
  );
}

/**
 * A scrollbar for a zoomed-in timeline: drag the thumb, or press anywhere on
 * the bar to jump there and keep dragging.
 */
function ScrollBar({ win, span, onScroll }: { win: ViewWindow; span: number; onScroll: (w: ViewWindow) => void }) {
  const len = win.end - win.start;
  // The thumb stays big enough to grab; the bar maps the rest.
  const MIN_THUMB = 0.02;
  const thumb = Math.max(MIN_THUMB, len / span);
  const left = span > len ? (win.start / (span - len)) * (1 - thumb) : 0;
  const grab = useRef<number | null>(null);
  const startAt = (e: React.PointerEvent<HTMLDivElement>, g: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1 - thumb, Math.max(0, (e.clientX - r.left) / r.width - g));
    onScroll(scroll(win, (frac / (1 - thumb || 1)) * (span - len) - win.start, span));
  };
  return (
    <div
      className="relative h-3 min-w-0 flex-1 cursor-pointer rounded bg-muted/60"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        const at = (e.clientX - r.left) / r.width;
        // On the thumb: keep the grab point under the pointer. Elsewhere: centre the thumb there.
        grab.current = at >= left && at <= left + thumb ? at - left : thumb / 2;
        startAt(e, grab.current);
      }}
      onPointerMove={(e) => grab.current !== null && startAt(e, grab.current)}
      onPointerUp={() => (grab.current = null)}
      onPointerCancel={() => (grab.current = null)}
      role="scrollbar"
      aria-orientation="horizontal"
      aria-controls="editor-timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(span * 1000) / 1000}
      aria-valuenow={Math.round(win.start * 1000) / 1000}
      aria-label="Scroll the timeline"
      data-testid="editor-scrollbar"
    >
      <div className="absolute inset-y-0 rounded bg-muted-foreground/60" style={{ left: `${left * 100}%`, width: `${thumb * 100}%` }} data-testid="editor-scroll-thumb" />
    </div>
  );
}

const fmtLen = (s: number) => (s >= 1 ? `${s.toFixed(1)} s` : `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms`);

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

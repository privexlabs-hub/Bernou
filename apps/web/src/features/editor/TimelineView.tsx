/**
 * The timeline, over the ORIGINAL recording's time, so removed sections stay
 * visible (hatched) and can be restored. Waveform for finding cut points; trim
 * handles at the ends; mutes tinted; overlays as bars to move and resize.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditProject, Overlay, TimeRange } from "@/db/dexie";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { normalizeRanges } from "./timeline";
import { setTrim, updateOverlay } from "./edits";

const WAVE_H = 72;
const BAR_ROW = 22;
const HANDLE_PX = 7;

type Drag =
  | { kind: "select"; from: number; x0: number }
  | { kind: "trim"; edge: "start" | "end" }
  | { kind: "overlay"; id: string; mode: "move" | "start" | "end"; t0: number; orig: TimeRange };

export function TimelineView({ duration, peaks, peaksPerSecond, onSeekSource }: { duration: number; peaks: Float32Array | null; peaksPerSecond: number; onSeekSource: (t: number) => void }) {
  const project = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const { selection, sourceTime, selectedOverlay, set } = useEditorUi();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<Drag | null>(null);
  // While dragging, a working copy shown before it becomes one undo step.
  const [preview, setPreview] = useState<Partial<{ trim: TimeRange; overlay: Overlay }>>({});
  const height = WAVE_H + BAR_ROW + 8;

  useEffect(() => {
    const el = canvas.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const x = useCallback((t: number) => (t / Math.max(duration, 1e-6)) * width, [duration, width]);
  const tAt = useCallback((px: number) => Math.min(duration, Math.max(0, (px / width) * duration)), [duration, width]);

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

    // Waveform
    ctx.fillStyle = "#1a1d26";
    ctx.fillRect(0, 0, width, WAVE_H);
    if (peaks && peaks.length) {
      ctx.fillStyle = "#7c8597";
      const mid = WAVE_H / 2;
      for (let px = 0; px < width; px++) {
        const a = Math.floor((tAt(px) * peaksPerSecond));
        const b = Math.max(a + 1, Math.floor(tAt(px + 1) * peaksPerSecond));
        let m = 0;
        for (let i = a; i < b && i < peaks.length; i++) m = Math.max(m, peaks[i]!);
        const hh = Math.max(1, Math.min(1, m * 1.6) * (mid - 2));
        ctx.fillRect(px, mid - hh, 1, hh * 2);
      }
    }
    // Mutes
    ctx.fillStyle = "rgba(239,68,68,0.28)";
    for (const m of normalizeRanges(project.audio.mutes, duration)) ctx.fillRect(x(m.start), 0, x(m.end) - x(m.start), WAVE_H);
    // Removed: outside the trim, and every cut
    const removed = normalizeRanges([...project.cuts, { start: 0, end: trim.start }, { start: trim.end, end: duration }], duration);
    for (const r of removed) hatch(ctx, x(r.start), 0, x(r.end) - x(r.start), WAVE_H);
    // Trim handles
    ctx.fillStyle = "#f59e0b";
    for (const t of [trim.start, trim.end]) ctx.fillRect(x(t) - 2, 0, 4, WAVE_H);
    // Selection
    if (selection) {
      ctx.fillStyle = "rgba(59,130,246,0.25)";
      ctx.fillRect(x(selection.start), 0, x(selection.end) - x(selection.start), WAVE_H);
      ctx.strokeStyle = "#3b82f6";
      ctx.strokeRect(x(selection.start) + 0.5, 0.5, x(selection.end) - x(selection.start) - 1, WAVE_H - 1);
    }
    // Overlays
    const y0 = WAVE_H + 4;
    for (const o of [...overlays].sort((a, b) => Number(a.id === selectedOverlay) - Number(b.id === selectedOverlay))) {
      const sel = o.id === selectedOverlay;
      ctx.fillStyle = o.kind === "text" ? (sel ? "#3b82f6" : "rgba(59,130,246,0.55)") : sel ? "#f59e0b" : "rgba(245,158,11,0.55)";
      ctx.fillRect(x(o.start), y0, Math.max(3, x(o.end) - x(o.start)), BAR_ROW - 4);
      ctx.fillStyle = "#0b0d12";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(o.kind === "text" ? o.text.slice(0, 40) : "Highlight", x(o.start) + 4, y0 + 13, Math.max(0, x(o.end) - x(o.start) - 8));
    }
    // Playhead
    ctx.fillStyle = "#f4f4f5";
    ctx.fillRect(x(sourceTime) - 1, 0, 2, height);
  }, [project, preview, selection, selectedOverlay, sourceTime, peaks, peaksPerSecond, width, height, duration, x, tAt]);

  const overlayAt = (px: number, py: number) => {
    if (py < WAVE_H + 2) return null;
    const hits = project.overlays.filter((o) => px >= x(o.start) - HANDLE_PX && px <= x(o.end) + HANDLE_PX);
    return hits.find((o) => o.id === selectedOverlay) ?? hits[hits.length - 1] ?? null;
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    const o = overlayAt(px, py);
    if (o) {
      set({ selectedOverlay: o.id });
      const mode = Math.abs(px - x(o.start)) <= HANDLE_PX ? "start" : Math.abs(px - x(o.end)) <= HANDLE_PX ? "end" : "move";
      drag.current = { kind: "overlay", id: o.id, mode, t0: tAt(px), orig: { start: o.start, end: o.end } };
      return;
    }
    for (const edge of ["start", "end"] as const) {
      if (py < WAVE_H && Math.abs(px - x(project.trim[edge])) <= HANDLE_PX) {
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
      if (Math.abs(px - d.x0) >= 3) set({ selection: { start: Math.min(d.from, t), end: Math.max(d.from, t) } });
    } else if (d.kind === "trim") {
      const trim = { ...project.trim };
      if (d.edge === "start") trim.start = Math.min(t, trim.end - 0.1);
      else trim.end = Math.max(t, trim.start + 0.1);
      setPreview({ trim });
    } else {
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
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (d.kind === "select" && Math.abs(px - d.x0) < 3) {
      set({ selection: null });
      onSeekSource(tAt(px));
    }
    if (d.kind === "trim" && preview.trim) change(setTrim(preview.trim));
    if (d.kind === "overlay" && preview.overlay) change(updateOverlay(d.id, { start: preview.overlay.start, end: preview.overlay.end }));
    setPreview({});
  };

  return (
    <div className="w-full min-w-0 select-none overflow-hidden">
      <canvas
        ref={canvas}
        style={{ width, height, touchAction: "none", cursor: "crosshair" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          setPreview({});
        }}
        aria-label="Timeline: drag to select a range"
        data-testid="editor-timeline"
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

export type { EditProject };

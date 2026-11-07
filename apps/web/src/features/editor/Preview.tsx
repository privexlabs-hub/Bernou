/**
 * The preview: the original video, muted (sound comes from the player), with
 * the picture filter as CSS and overlays drawn on a canvas above it by the same
 * function the export uses. Overlays can be moved and resized here.
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import type { Overlay } from "@/db/dexie";
import { useEditorStore } from "@/stores/private/editorStore";
import { useEditorUi } from "@/stores/private/editorUiStore";
import { drawOverlays, pictureFilter } from "./render";
import { updateOverlay } from "./edits";

const HANDLE = 14; // px, the resize corner

export const Preview = forwardRef<HTMLVideoElement, { src: string; width: number; height: number }>(function Preview({ src, width, height }, videoRef) {
  const project = useEditorStore((s) => s.project)!;
  const change = useEditorStore((s) => s.change);
  const { sourceTime, selectedOverlay, set } = useEditorUi();
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const drag = useRef<{ id: string; mode: "move" | "resize"; x0: number; y0: number; orig: Overlay } | null>(null);
  const [working, setWorking] = useState<Overlay | null>(null);

  // The largest frame of the video's shape that fits the space, in both directions.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ratio = (width || 16) / (height || 9);
    const fit = () => {
      const w = Math.max(1, Math.min(el.clientWidth, el.clientHeight * ratio));
      setSize({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const overlays = project.overlays.map((o) => (working && o.id === working.id ? working : o));

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    drawOverlays(ctx, overlays, sourceTime, size.w, size.h);
    const sel = overlays.find((o) => o.id === selectedOverlay && sourceTime >= o.start && sourceTime < o.end);
    if (sel) {
      ctx.strokeStyle = "#3b82f6";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sel.x * size.w, sel.y * size.h, sel.w * size.w, sel.h * size.h);
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect((sel.x + sel.w) * size.w - HANDLE / 2, (sel.y + sel.h) * size.h - HANDLE / 2, HANDLE, HANDLE);
    }
  }, [overlays, sourceTime, selectedOverlay, size]);

  const hit = (px: number, py: number) => {
    const active = overlays.filter((o) => sourceTime >= o.start && sourceTime < o.end);
    const inside = (o: Overlay) => px >= o.x * size.w && px <= (o.x + o.w) * size.w && py >= o.y * size.h && py <= (o.y + o.h) * size.h;
    const corner = (o: Overlay) => Math.abs(px - (o.x + o.w) * size.w) <= HANDLE && Math.abs(py - (o.y + o.h) * size.h) <= HANDLE;
    const sel = active.find((o) => o.id === selectedOverlay);
    if (sel && corner(sel)) return { o: sel, mode: "resize" as const };
    const o = (sel && inside(sel) ? sel : null) ?? [...active].reverse().find(inside);
    return o ? { o, mode: "move" as const } : null;
  };

  return (
    <div ref={area} className="flex h-full w-full items-center justify-center overflow-hidden">
    <div className="relative overflow-hidden rounded-md bg-black" style={{ width: size.w, height: size.h }}>
      <video ref={videoRef} src={src} muted playsInline preload="auto" className="absolute inset-0 h-full w-full" style={{ filter: pictureFilter(project.picture) }} data-testid="editor-video" />
      <canvas
        ref={canvas}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none" }}
        data-testid="editor-overlay-canvas"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const h = hit(e.clientX - r.left, e.clientY - r.top);
          if (!h) return set({ selectedOverlay: null });
          set({ selectedOverlay: h.o.id });
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: h.o.id, mode: h.mode, x0: e.clientX, y0: e.clientY, orig: h.o };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = (e.clientX - d.x0) / size.w;
          const dy = (e.clientY - d.y0) / size.h;
          setWorking(d.mode === "move" ? { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy } : { ...d.orig, w: d.orig.w + dx, h: d.orig.h + dy });
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && working) change(updateOverlay(d.id, { x: working.x, y: working.y, w: working.w, h: working.h }));
          setWorking(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setWorking(null);
        }}
      />
    </div>
    </div>
  );
});

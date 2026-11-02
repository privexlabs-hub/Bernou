/**
 * Presenter-only interaction layer above the preview canvas.
 *
 * Renders an outline and a resize handle as DOM elements positioned over the
 * camera overlay, and translates pointer gestures into composition-store
 * updates. It never draws onto the engine canvas, so the audience pixels are
 * unaffected by anything here.
 */
import { useCallback, useRef } from "react";
import type { AudiencePayload } from "@bernou/audience-protocol";
import { cameraRect } from "@bernou/composition-engine";
import { useCompositionStore } from "@/stores/public/compositionStore";
import type { DisplayRect } from "./displayRect";
import { cn } from "@/lib/utils";

const MIN_SIZE = 0.06;

export function OverlayHandles({ payload, display }: { payload: AudiencePayload; display: DisplayRect }) {
  const patchCamera = useCompositionStore((s) => s.patchCamera);
  const cam = payload.camera;
  const visible = cam.enabled && payload.layout === "slide-with-camera";
  const drag = useRef<{ mode: "move" | "resize"; startX: number; startY: number; x0: number; y0: number; size0: number } | null>(null);

  const { width: W, height: H } = payload.output;
  const scale = display.width / W || 1;
  const r = cameraRect(cam, W, H);
  const style = { left: display.left + r.x * scale, top: display.top + r.y * scale, width: r.w * scale, height: r.h * scale };

  const onPointerDown = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const c = useCompositionStore.getState().camera;
      drag.current = { mode, startX: e.clientX, startY: e.clientY, x0: c.x, y0: c.y, size0: c.size };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / scale / W; // normalised
      const dy = (e.clientY - d.startY) / scale / H;
      if (d.mode === "move") {
        // Clamping happens in the bridge (clampCamera); we pre-clamp for a stable handle too.
        patchCamera({ x: clamp(d.x0 + dx, 0, 1 - cam.size), y: clamp(d.y0 + dy, 0, 1 - r.h / H) });
      } else {
        const next = clamp(d.size0 + dx, MIN_SIZE, 1);
        patchCamera({ size: next });
      }
    },
    [scale, W, H, cam.size, r.h, patchCamera],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  if (!visible || display.width === 0) return null;

  return (
    <div
      role="group"
      aria-label="Camera overlay (drag to move, corner to resize, double-click to toggle shape)"
      data-testid="overlay-handle"
      className={cn("group absolute cursor-move touch-none select-none outline outline-2 outline-offset-2 outline-primary/0 transition-[outline-color] hover:outline-primary/70", cam.shape === "circle" ? "rounded-full" : "rounded-lg")}
      style={style}
      onPointerDown={onPointerDown("move")}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => patchCamera({ shape: cam.shape === "circle" ? "rect" : "circle" })}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.05 : 0.01;
        const c = useCompositionStore.getState().camera;
        if (e.key === "ArrowLeft") patchCamera({ x: clamp(c.x - step, 0, 1) });
        if (e.key === "ArrowRight") patchCamera({ x: clamp(c.x + step, 0, 1) });
        if (e.key === "ArrowUp") patchCamera({ y: clamp(c.y - step, 0, 1) });
        if (e.key === "ArrowDown") patchCamera({ y: clamp(c.y + step, 0, 1) });
        if (e.key === "+" || e.key === "=") patchCamera({ size: clamp(c.size + step, MIN_SIZE, 1) });
        if (e.key === "-") patchCamera({ size: clamp(c.size - step, MIN_SIZE, 1) });
      }}
      tabIndex={0}
    >
      <div
        data-testid="overlay-resize"
        aria-label="Resize camera overlay"
        className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border border-background bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        onPointerDown={onPointerDown("resize")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

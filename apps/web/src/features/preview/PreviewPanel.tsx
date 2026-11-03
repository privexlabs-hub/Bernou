/**
 * Centre panel: the audience preview.
 *
 * The <canvas> is driven by the composition engine at the real output
 * resolution and CSS-scaled to fit the panel, so what the presenter sees is
 * the actual composition — not an approximation. The overlay layer above it
 * (step 2.6) is DOM-only and never touches the canvas pixels.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { FrameSource } from "@bernou/composition-engine";
import { usePreviewEngine } from "./usePreviewEngine";
import { OverlayHandles } from "./OverlayHandles";
import { CameraHint } from "./CameraHint";
import { InkLayer } from "@/features/ink/InkLayer";
import { InkToolbar } from "@/features/ink/InkToolbar";
import { useInkToolStore } from "@/stores/private/inkToolStore";
import { Eye } from "lucide-react";
import type { DisplayRect } from "./displayRect";

export function PreviewPanel({ cameraSource, cameraStalled }: { cameraSource: FrameSource | null; cameraStalled: boolean }) {
  const { canvasRef, payload } = usePreviewEngine(cameraSource);
  const inkTool = useInkToolStore((s) => s.tool);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState<DisplayRect>({ left: 0, top: 0, width: 0, height: 0 });

  // Fit the canvas inside the wrapper, preserving the output aspect ratio.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const compute = () => {
      const W = wrap.clientWidth;
      const H = wrap.clientHeight;
      const aspect = payload ? payload.output.width / payload.output.height : 16 / 9;
      let w = W;
      let h = W / aspect;
      if (h > H) {
        h = H;
        w = H * aspect;
      }
      setDisplay({ left: (W - w) / 2, top: (H - h) / 2, width: w, height: h });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [payload?.output.width, payload?.output.height]);

  return (
    <section className="panel flex h-full flex-col overflow-hidden" aria-label="Audience preview">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="panel-title">Audience preview</span>
        <span className="flex-1" />
        <InkToolbar />
        <span className="ml-3 flex items-center gap-1.5 text-[11px] text-muted-foreground" title="This is the exact composition the audience receives">
          <Eye className="h-3 w-3" />
          {payload ? `${payload.output.width}×${payload.output.height}` : ""}
        </span>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 bg-black" data-testid="preview-wrap">
        <canvas
          ref={canvasRef}
          data-testid="preview-canvas"
          className="absolute"
          style={{ left: display.left, top: display.top, width: display.width, height: display.height }}
        />
        {payload && !inkTool && <OverlayHandles payload={payload} display={display} />}
        {payload?.slide && <InkLayer payload={payload} display={display} />}
        <CameraHint stalled={cameraStalled} />
      </div>
    </section>
  );
}

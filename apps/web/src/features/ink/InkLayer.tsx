/**
 * Presenter-only input over the preview: turns the mouse into marks. The marks
 * themselves are drawn by the engine from the payload, so the preview, audience
 * window and recording all get the same pixels. With no tool in hand this isn't
 * rendered at all, and the preview behaves as it always has.
 */
import { useCallback, useEffect, useRef } from "react";
import { INK_COORD_MAX, type AudiencePayload } from "@bernou/audience-protocol";
import { saveInk } from "@/db/repositories/ink";
import type { DisplayRect } from "@/features/preview/displayRect";
import { useInkToolStore } from "@/stores/private/inkToolStore";
import { useSessionStore } from "@/stores/private/sessionStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { useInkStore } from "@/stores/public/inkStore";
import { eraseAt } from "./eraseAt";
import { fitSlide } from "./fitSlide";

/** Closer points than this add size without adding shape. */
const MIN_POINT_SPACING_PX = 2;
const ERASER_RADIUS_PX = 12;

const CURSOR = { pointer: "none", pen: "crosshair", highlighter: "crosshair", eraser: "cell" } as const;

export function InkLayer({ payload, display }: { payload: AudiencePayload; display: DisplayRect }) {
  const tool = useInkToolStore((s) => s.tool);
  const layer = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ slide: number; lastX: number; lastY: number } | null>(null);

  const slideOnScreen = () => {
    const slide = payload.slide;
    if (!slide) return null;
    const scale = display.width / payload.output.width;
    const r = fitSlide(slide.width, slide.height, payload.output.width, payload.output.height);
    return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
  };

  /** Mouse position relative to the slide, or null when off it, unless told to keep it on. */
  const toInk = useCallback(
    (e: { clientX: number; clientY: number }, clampToSlide: boolean) => {
      const box = layer.current?.getBoundingClientRect();
      const s = slideOnScreen();
      if (!box || !s) return null;
      const nx = (e.clientX - box.left - s.x) / s.w;
      const ny = (e.clientY - box.top - s.y) / s.h;
      if (!clampToSlide && (nx < 0 || nx > 1 || ny < 0 || ny > 1)) return null;
      const scaled = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * INK_COORD_MAX);
      return { x: scaled(nx), y: scaled(ny) };
    },
    [display, payload.slide, payload.output.width, payload.output.height],
  );

  const eraseUnder = (e: { clientX: number; clientY: number }) => {
    const p = toInk(e, true);
    const s = slideOnScreen();
    if (!p || !s) return;
    const slide = useDeckStore.getState().activeIndex;
    const ink = useInkStore.getState();
    const before = ink.bySlide[slide] ?? [];
    const after = eraseAt(before, p.x, p.y, (ERASER_RADIUS_PX / s.w) * INK_COORD_MAX, (ERASER_RADIUS_PX / s.h) * INK_COORD_MAX);
    if (after !== before) ink.setStrokes(slide, after);
  };

  const save = (slide: number) => {
    const sessionId = useSessionStore.getState().session?.id;
    if (sessionId) void saveInk(sessionId, slide, useInkStore.getState().bySlide[slide] ?? []);
  };

  const finish = useCallback(() => {
    const d = drawing.current;
    drawing.current = null;
    if (d) save(d.slide);
  }, []);

  // Leaving the tool or the slide mid-stroke still keeps the stroke, and takes the dot away.
  useEffect(() => () => {
    finish();
    useInkStore.getState().setPointer(null);
  }, [finish, tool]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "pointer" || !tool) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const slide = useDeckStore.getState().activeIndex;
    if (tool === "eraser") {
      drawing.current = { slide, lastX: e.clientX, lastY: e.clientY };
      eraseUnder(e);
      return;
    }
    const p = toInk(e, false);
    if (!p) return;
    if (useInkStore.getState().beginStroke(slide, tool, useInkToolStore.getState().color, p.x, p.y)) drawing.current = { slide, lastX: e.clientX, lastY: e.clientY };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (tool === "pointer") {
      useInkStore.getState().setPointer(toInk(e, false));
      return;
    }
    const d = drawing.current;
    if (!d) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      if (Math.hypot(ev.clientX - d.lastX, ev.clientY - d.lastY) < MIN_POINT_SPACING_PX) continue;
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;
      if (tool === "eraser") {
        eraseUnder(ev);
        continue;
      }
      const p = toInk(ev, true);
      if (p) useInkStore.getState().extendStroke(d.slide, p.x, p.y);
    }
  };

  if (!tool) return null;
  return (
    <div
      ref={layer}
      className="absolute touch-none"
      style={{ left: display.left, top: display.top, width: display.width, height: display.height, cursor: CURSOR[tool] }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={() => tool === "pointer" && useInkStore.getState().setPointer(null)}
      data-testid="ink-layer"
    />
  );
}

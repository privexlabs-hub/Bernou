/** Presenter-only annotation tools, in the preview's header. */
import { useEffect } from "react";
import { Eraser, Highlighter, Pen, Pointer, Trash2 } from "lucide-react";
import { INK_COLORS, MAX_INK_POINTS, MAX_INK_STROKES } from "@bernou/audience-protocol";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { saveInk } from "@/db/repositories/ink";
import { isEditableTarget } from "@/features/slides/useSlideShortcuts";
import { registerStopper } from "@/features/safety/emergencyStop";
import { cn } from "@/lib/utils";
import { useInkToolStore, type InkTool } from "@/stores/private/inkToolStore";
import { useSessionStore } from "@/stores/private/sessionStore";
import { useCompositionStore } from "@/stores/public/compositionStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { inkPointCount, useInkStore } from "@/stores/public/inkStore";

const TOOLS: Array<{ id: InkTool; label: string; key: string; icon: React.ReactNode }> = [
  { id: "pointer", label: "Pointer", key: "L", icon: <Pointer /> },
  { id: "pen", label: "Pen", key: "P", icon: <Pen /> },
  { id: "highlighter", label: "Highlighter", key: "H", icon: <Highlighter /> },
  { id: "eraser", label: "Eraser", key: "E", icon: <Eraser /> },
];

// Stop all takes the pointer off the slide and the tool out of the presenter's hand.
registerStopper(() => {
  useInkStore.getState().setPointer(null);
  useInkToolStore.getState().setTool(null);
});

/** The active slide, if it's what the audience is being shown. */
function useMarkableSlide() {
  const hasSlide = useDeckStore((s) => s.slides.length > 0);
  const layout = useCompositionStore((s) => s.layout);
  return hasSlide && layout !== "camera-full" && layout !== "blank";
}

export function useInkShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const { tool, setTool } = useInkToolStore.getState();
      if (e.key === "Escape" && tool) {
        setTool(null);
        return;
      }
      const picked = TOOLS.find((t) => t.key === e.key.toUpperCase());
      if (!picked) return;
      const { slides } = useDeckStore.getState();
      const { layout } = useCompositionStore.getState();
      if (slides.length > 0 && layout !== "camera-full" && layout !== "blank") setTool(tool === picked.id ? null : picked.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function InkToolbar() {
  const tool = useInkToolStore((s) => s.tool);
  const color = useInkToolStore((s) => s.color);
  const setTool = useInkToolStore((s) => s.setTool);
  const setColor = useInkToolStore((s) => s.setColor);
  const activeSlide = useDeckStore((s) => s.activeIndex);
  const strokes = useInkStore((s) => s.bySlide[activeSlide]);
  const markable = useMarkableSlide();

  // A layout with no slide leaves nothing to mark.
  useEffect(() => {
    if (!markable) setTool(null);
  }, [markable, setTool]);

  const full = (strokes?.length ?? 0) >= MAX_INK_STROKES || inkPointCount(strokes) >= MAX_INK_POINTS;
  const usesColor = tool === "pen" || tool === "highlighter";

  return (
    <div className="flex items-center gap-1" data-testid="ink-toolbar">
      {full && (
        <span className="text-[11px] text-destructive" role="status" data-testid="ink-full">
          This slide is full. Clear some marks to add more.
        </span>
      )}
      {usesColor &&
        INK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={cn("h-4 w-4 rounded-full border border-border", color === c && "ring-2 ring-primary ring-offset-1 ring-offset-background")}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            data-testid={`ink-color-${c.slice(1)}`}
          />
        ))}
      {TOOLS.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger asChild>
            <span>
              <Button
                size="icon-sm"
                variant={tool === t.id ? "secondary" : "ghost"}
                className={cn("h-6 w-6", tool === t.id && "text-primary")}
                disabled={!markable}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                onClick={() => setTool(tool === t.id ? null : t.id)}
                data-testid={`ink-tool-${t.id}`}
              >
                {t.icon}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{markable ? `${t.label} (${t.key}). Shows on the audience output. Esc puts it down.` : "Needs a slide on screen"}</TooltipContent>
        </Tooltip>
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              size="icon-sm"
              variant="ghost"
              className="h-6 w-6"
              disabled={!strokes?.length}
              aria-label="Clear this slide's marks"
              onClick={() => {
                useInkStore.getState().clearSlide(activeSlide);
                const sessionId = useSessionStore.getState().session?.id;
                if (sessionId) void saveInk(sessionId, activeSlide, []);
              }}
              data-testid="ink-clear"
            >
              <Trash2 />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Clear this slide&apos;s marks</TooltipContent>
      </Tooltip>
    </div>
  );
}

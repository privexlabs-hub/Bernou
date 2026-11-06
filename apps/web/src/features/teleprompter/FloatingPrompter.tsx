/**
 * PRIVATE floating prompter: the scrolling text, with the controls a presenter
 * needs while reading beside the camera. The same content goes in a real
 * floating window or, where the browser has none, a panel in the page.
 *
 * Nothing here can reach the audience: slide buttons go through the deck store
 * like any other slide change.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Gauge, GripHorizontal, Minus, Pause, PictureInPicture2, Play, Plus } from "lucide-react";
import { Button } from "@/ui/button";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { handlePrompterKey, PrompterText } from "./PrompterText";
import { clampPanelBox, closeFloat, loadPanelBox, MIN_PANEL_HEIGHT, MIN_PANEL_WIDTH, savePanelBox, type PanelBox } from "./floatingWindow";

/** Keys for whichever shell has focus. Returns true if handled. */
function handleFloatKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.key === "PageDown") {
    useDeckStore.getState().next();
    return true;
  }
  if (e.key === "PageUp") {
    useDeckStore.getState().prev();
    return true;
  }
  if (e.key === " " && useScriptStore.getState().sections.length === 0) return true;
  return handlePrompterKey(e);
}

export function FloatingPrompter() {
  const float = useTeleprompterStore((s) => s.float);
  useEffect(() => closeFloat, []); // leaving the studio takes it down
  if (!float) return null;
  if (float.kind === "window") return createPortal(<FloatWindowKeys win={float.win} />, float.win.document.body);
  return <FloatPanel />;
}

/** One owner for keys in the window, so the text's own handler can't fire a second time. */
function FloatWindowKeys({ win }: { win: Window }) {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!handleFloatKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === " ") e.preventDefault(); // Firefox presses a focused button on keyup
    };
    win.addEventListener("keydown", onDown, true);
    win.addEventListener("keyup", onUp, true);
    return () => {
      win.removeEventListener("keydown", onDown, true);
      win.removeEventListener("keyup", onUp, true);
    };
  }, [win]);
  return (
    <div className="flex h-full flex-col outline-none" tabIndex={-1} data-testid="float-prompter" data-kind="window">
      <FloatContent />
    </div>
  );
}

function FloatPanel() {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<PanelBox>(() => loadPanelBox(window.innerWidth, window.innerHeight));
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onResize = () => setBox((b) => clampPanelBox(b, window.innerWidth, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The browser's resize corner sets the element's size directly.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setBox((b) => (b.width === el.offsetWidth && b.height === el.offsetHeight ? b : clampPanelBox({ ...b, width: el.offsetWidth, height: el.offsetHeight }, window.innerWidth, window.innerHeight))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => savePanelBox(box), [box]);

  return (
    <div
      ref={root}
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl outline-none"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height, minWidth: MIN_PANEL_WIDTH, minHeight: MIN_PANEL_HEIGHT, resize: "both" }}
      tabIndex={-1}
      role="dialog"
      aria-label="Floating prompter (private)"
      data-testid="float-prompter"
      data-kind="panel"
      onKeyDown={(e) => {
        if (!handleFloatKey(e.nativeEvent)) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyUp={(e) => {
        if (e.key === " ") e.preventDefault();
      }}
    >
      <div
        className="flex shrink-0 cursor-move touch-none items-center justify-center gap-1 border-b border-border/70 py-0.5 text-[11px] text-muted-foreground"
        data-testid="float-drag-handle"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { dx: e.clientX - box.x, dy: e.clientY - box.y };
          root.current?.focus();
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const { dx, dy } = drag.current;
          setBox((b) => clampPanelBox({ ...b, x: e.clientX - dx, y: e.clientY - dy }, window.innerWidth, window.innerHeight));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <GripHorizontal className="h-3 w-3" /> Drag to move
      </div>
      <FloatContent />
    </div>
  );
}

function FloatContent() {
  const status = useTeleprompterStore((s) => s.model.status);
  const speed = useTeleprompterStore((s) => s.settings.speed);
  const { toggle, speedUp, speedDown } = useTeleprompterStore.getState();
  const empty = useScriptStore((s) => s.sections.length === 0);
  const active = useDeckStore((s) => s.activeIndex);
  const slideCount = useDeckStore((s) => s.slides.length);
  const { next, prev } = useDeckStore.getState();
  const playing = status === "playing";

  return (
    <>
      {/* The text comes first: the top of the window is nearest the camera. */}
      <PrompterText floating />
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border/70 bg-panel px-2 py-1">
        <FloatButton label={`${playing ? "Pause" : "Start"} (Space)`} onClick={toggle} disabled={empty} testId="float-toggle" primary>
          {playing ? <Pause /> : <Play />}
        </FloatButton>
        <FloatButton label="Slower (←)" onClick={speedDown} testId="float-slower">
          <Minus />
        </FloatButton>
        <span className="flex w-12 items-center justify-center gap-1 font-mono text-xs text-muted-foreground" title="Scroll speed, in px/s" data-testid="float-speed">
          <Gauge className="h-3 w-3" /> {speed}
        </span>
        <FloatButton label="Faster (→)" onClick={speedUp} testId="float-faster">
          <Plus />
        </FloatButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <FloatButton label="Previous slide (Page Up)" onClick={prev} disabled={active === 0} testId="float-slide-prev">
          <ChevronLeft />
        </FloatButton>
        <span className="min-w-10 text-center font-mono text-xs text-muted-foreground" data-testid="float-slide-counter">
          {slideCount === 0 ? "No slides" : `${active + 1} / ${slideCount}`}
        </span>
        <FloatButton label="Next slide (Page Down)" onClick={next} disabled={active >= slideCount - 1} testId="float-slide-next">
          <ChevronRight />
        </FloatButton>
        <span className="flex-1" />
        <FloatButton label="Bring the text back to the Prompter tab" onClick={closeFloat} testId="float-back">
          <PictureInPicture2 />
        </FloatButton>
      </div>
    </>
  );
}

/**
 * Uses `title`, not the app's Tooltip: that one portals into the main window.
 * A click leaves focus on the prompter rather than the button, so the next
 * Space means play/pause, not "press this button again".
 */
function FloatButton({ label, onClick, disabled, testId, primary, children }: { label: string; onClick: () => void; disabled?: boolean; testId: string; primary?: boolean; children: ReactNode }) {
  return (
    <Button
      size="icon-sm"
      variant={primary ? "default" : "ghost"}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={(e) => {
        e.preventDefault();
        e.currentTarget.closest<HTMLElement>('[data-testid="float-prompter"]')?.focus();
      }}
    >
      {children}
    </Button>
  );
}

/**
 * PRIVATE teleprompter text: the part that scrolls.
 *
 * Renders the script as large text in a scroll container driven by the scroll
 * model (time-based, rAF). A fixed reading line with a dimmed zone above and
 * below marks the current reading position. Manual wheel/drag scrolling is
 * always allowed. Keyboard shortcuts work when the prompter has focus and
 * also globally (see useTeleprompterShortcuts) when not typing.
 *
 * Nothing here can reach the audience: it is DOM in the presenter's windows only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { cn } from "@/lib/utils";

export function PrompterText() {
  const settings = useTeleprompterStore((s) => s.settings);
  const model = useTeleprompterStore((s) => s.model);
  const visible = useTeleprompterStore((s) => s.visible);
  const { stop, nudge, seek, setMaxPosition, tick } = useTeleprompterStore.getState();
  const sections = useScriptStore((s) => s.sections);
  const activeSlide = useDeckStore((s) => s.activeIndex);
  const slideCount = useDeckStore((s) => s.slides.length);

  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);

  // rAF loop while playing
  useEffect(() => {
    if (model.status !== "playing" || !visible) return;
    let id = 0;
    const loop = (ts: number) => {
      tick(ts);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [model.status, visible, tick]);

  // Apply model position to the DOM and measure max position.
  useEffect(() => {
    const vp = viewport.current;
    const ct = content.current;
    if (!vp || !ct) return;
    const measure = () => {
      setViewportHeight(vp.clientHeight);
      setMaxPosition(Math.max(0, ct.scrollHeight - vp.clientHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(ct);
    return () => ro.disconnect();
  }, [sections, settings.fontSize, settings.readingZone, settings.readingLine, setMaxPosition]);

  // No text to scroll: a playing prompter would otherwise run on with Pause disabled.
  useEffect(() => {
    if (sections.length > 0) return;
    setMaxPosition(0);
    stop();
  }, [sections.length, setMaxPosition, stop]);

  useEffect(() => {
    const vp = viewport.current;
    if (vp && Math.abs(vp.scrollTop - model.position) > 0.5) vp.scrollTop = model.position;
  }, [model.position]);

  // Which section is under the reading line (for the indicator + follow-slides)
  const readingLinePx = useCallback(() => {
    const vp = viewport.current;
    return vp ? vp.clientHeight * settings.readingLine : 0;
  }, [settings.readingLine]);

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const lineY = model.position + readingLinePx();
    let found: string | null = null;
    for (const [id, el] of sectionEls.current) {
      if (el.offsetTop <= lineY) found = id;
    }
    if (found !== currentSectionId) setCurrentSectionId(found);
  }, [model.position, readingLinePx, currentSectionId, sections]);

  // Follow slides: jump to the first section linked to the active slide. One
  // way only, and a slide with no link leaves the prompter where it is.
  const lastSlideJump = useRef<number | null>(null);
  useEffect(() => {
    if (!settings.followSlides) {
      lastSlideJump.current = null;
      return;
    }
    if (lastSlideJump.current === activeSlide) return;
    lastSlideJump.current = activeSlide;
    const target = sections.find((s) => s.slideIndex === activeSlide);
    const el = target ? sectionEls.current.get(target.id) : null;
    if (el) seek(Math.max(0, el.offsetTop - readingLinePx()));
  }, [activeSlide, settings.followSlides, sections, seek, readingLinePx]);

  // Manual scrolling by wheel / touch moves the model, not just the DOM.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      nudge(e.deltaY);
    },
    [nudge],
  );
  const onScroll = useCallback(() => {
    const vp = viewport.current;
    if (vp && Math.abs(vp.scrollTop - useTeleprompterStore.getState().model.position) > 1) seek(vp.scrollTop);
  }, [seek]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const handled = handlePrompterKey(e.nativeEvent);
      if (handled) {
        e.preventDefault();
        e.stopPropagation(); // keep slide-navigation arrows from firing while the prompter has focus
      }
    },
    [],
  );

  const empty = sections.length === 0;
  const zoneTop = settings.readingLine - settings.readingZone / 2;
  const zoneBottom = settings.readingLine + settings.readingZone / 2;
  const dimStyle = useMemo(
    () => ({
      background: `linear-gradient(to bottom, ${settings.backgroundColor}e6 0%, ${settings.backgroundColor}e6 ${Math.max(0, zoneTop) * 100}%, transparent ${Math.max(0, zoneTop) * 100 + 6}%, transparent ${Math.min(1, zoneBottom) * 100 - 6}%, ${settings.backgroundColor}e6 ${Math.min(1, zoneBottom) * 100}%, ${settings.backgroundColor}e6 100%)`,
    }),
    [settings.backgroundColor, zoneTop, zoneBottom],
  );

  return (
      <div className="relative min-h-0 flex-1" style={{ background: settings.backgroundColor }}>
        {empty ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">Write or paste a script in the Script tab to use the teleprompter.</div>
        ) : (
          <>
            <div
              ref={viewport}
              tabIndex={0}
              role="region"
              aria-label="Teleprompter text (private)"
              className="h-full overflow-y-auto overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60"
              style={{ scrollbarWidth: "none" }}
              onWheel={onWheel}
              onScroll={onScroll}
              onKeyDown={onKeyDown}
              data-testid="prompter-viewport"
            >
              <div
                ref={content}
                className="px-6"
                style={{
                  // In px: percentages here would be of the width, not the height.
                  paddingTop: viewportHeight * settings.readingLine,
                  paddingBottom: viewportHeight * (1 - settings.readingLine),
                  fontSize: settings.fontSize,
                  lineHeight: 1.45,
                  color: settings.textColor,
                  textAlign: settings.align,
                  transform: settings.mirror ? "scaleX(-1)" : undefined,
                }}
              >
                {sections.map((sec) => (
                  <section
                    key={sec.id}
                    ref={(el) => {
                      if (el) sectionEls.current.set(sec.id, el);
                      else sectionEls.current.delete(sec.id);
                    }}
                    data-testid="prompter-section"
                    data-current={sec.id === currentSectionId ? "true" : undefined}
                    className={cn("mb-[1.2em] transition-opacity", sec.id === currentSectionId ? "opacity-100" : "opacity-90")}
                  >
                    {(sec.title || sec.slideIndex !== null) && (
                      <h3 className="mb-[0.3em] text-[0.6em] font-semibold uppercase tracking-[0.15em] opacity-60">
                        {sec.title}
                        {sec.slideIndex !== null && (
                          <span className={cn("rounded border border-current px-1 py-px text-[0.8em] opacity-70", sec.title && "ml-2")}>
                            slide {sec.slideIndex + 1}
                            {sec.slideIndex >= slideCount && " (not in this deck)"}
                          </span>
                        )}
                      </h3>
                    )}
                    <p className="whitespace-pre-wrap break-words">{sec.body}</p>
                  </section>
                ))}
              </div>
            </div>
            {/* Dimmed zones (pointer-events none so the text scrolls underneath) */}
            <div className="pointer-events-none absolute inset-0" style={dimStyle} aria-hidden />
            {/* Reading line */}
            <div className="pointer-events-none absolute left-0 right-0 flex items-center" style={{ top: `${settings.readingLine * 100}%` }} aria-hidden data-testid="prompter-reading-line">
              <ArrowDownToLine className="ml-1 h-3 w-3 -rotate-90 text-primary" />
              <div className="h-px flex-1 bg-primary/50" />
            </div>
          </>
        )}
      </div>
  );
}

/** Shared key handling for the prompter. Returns true if handled. */
export function handlePrompterKey(e: KeyboardEvent): boolean {
  const t = useTeleprompterStore.getState();
  switch (e.key) {
    case " ":
      t.toggle();
      return true;
    case "Escape":
      t.stop();
      return true;
    case "Home":
      t.reset();
      return true;
    case "ArrowLeft":
      t.speedDown();
      return true;
    case "ArrowRight":
      t.speedUp();
      return true;
    case "ArrowUp":
      t.nudge(e.shiftKey ? -200 : -40);
      return true;
    case "ArrowDown":
      t.nudge(e.shiftKey ? 200 : 40);
      return true;
    default:
      return false;
  }
}

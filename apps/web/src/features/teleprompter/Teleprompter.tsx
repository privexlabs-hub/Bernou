/**
 * PRIVATE teleprompter view.
 *
 * Renders the script as large text in a scroll container driven by the scroll
 * model (time-based, rAF). A fixed reading line with a dimmed zone above and
 * below marks the current reading position. Manual wheel/drag scrolling is
 * always allowed. Keyboard shortcuts work when the prompter has focus and
 * also globally (see useTeleprompterShortcuts) when not typing.
 *
 * Nothing here can reach the audience: it is DOM in the presenter window only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Gauge, Minus, Pause, Play, Plus, RotateCcw, Square, Type } from "lucide-react";
import { Button } from "@/ui/button";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";
import { Label } from "@/ui/label";
import { Input } from "@/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { progress, remainingSeconds } from "./scrollModel";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Teleprompter() {
  const settings = useTeleprompterStore((s) => s.settings);
  const model = useTeleprompterStore((s) => s.model);
  const followSlides = useTeleprompterStore((s) => s.followSlides);
  const { patchSettings, play, pause, toggle, stop, reset, nudge, seek, setMaxPosition, tick, setFollowSlides } = useTeleprompterStore.getState();
  const sections = useScriptStore((s) => s.sections);
  const activeSlide = useDeckStore((s) => s.activeIndex);

  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());
  const [showSettings, setShowSettings] = useState(false);
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(null);

  // rAF loop while playing
  useEffect(() => {
    if (model.status !== "playing") return;
    let id = 0;
    const loop = (ts: number) => {
      tick(ts);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [model.status, tick]);

  // Apply model position to the DOM and measure max position.
  useEffect(() => {
    const vp = viewport.current;
    const ct = content.current;
    if (!vp || !ct) return;
    const measure = () => setMaxPosition(Math.max(0, ct.scrollHeight - vp.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(ct);
    return () => ro.disconnect();
  }, [sections, settings.fontSize, settings.readingZone, setMaxPosition]);

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

  // Follow slides: jump to the first section linked to the active slide.
  const lastSlideJump = useRef<number | null>(null);
  useEffect(() => {
    if (!followSlides || lastSlideJump.current === activeSlide) return;
    lastSlideJump.current = activeSlide;
    const target = sections.find((s) => s.slideIndex === activeSlide);
    const el = target ? sectionEls.current.get(target.id) : null;
    if (el) seek(Math.max(0, el.offsetTop - readingLinePx()));
  }, [activeSlide, followSlides, sections, seek, readingLinePx]);

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

  const pct = progress(model);
  const remaining = remainingSeconds(model);
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
    <div className="flex h-full flex-col" data-testid="teleprompter" data-status={model.status}>
      {/* Transport */}
      <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant={model.status === "playing" ? "secondary" : "default"} onClick={toggle} disabled={empty} data-testid="prompter-toggle" aria-label={model.status === "playing" ? "Pause" : "Start"}>
              {model.status === "playing" ? <Pause /> : <Play />}
              {model.status === "playing" ? "Pause" : model.status === "paused" ? "Resume" : "Start"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Space <span className="kbd ml-1">⎵</span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={stop} disabled={model.status === "idle"} aria-label="Stop" data-testid="prompter-stop">
              <Square />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stop (keeps position) — Esc</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={reset} aria-label="Reset to top" data-testid="prompter-reset">
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset to top — Home</TooltipContent>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={() => useTeleprompterStore.getState().speedDown()} aria-label="Slower" data-testid="prompter-slower">
              <Minus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Slower — ←</TooltipContent>
        </Tooltip>
        <span className="flex w-16 items-center justify-center gap-1 font-mono text-xs text-muted-foreground" data-testid="prompter-speed">
          <Gauge className="h-3 w-3" /> {settings.speed}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={() => useTeleprompterStore.getState().speedUp()} aria-label="Faster" data-testid="prompter-faster">
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Faster — →</TooltipContent>
        </Tooltip>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="prompter-remaining" title="Time remaining at this speed">
          {Number.isFinite(remaining) ? `-${formatDuration(remaining * 1000)}` : "--:--"}
        </span>
        <Button size="icon-sm" variant={showSettings ? "secondary" : "ghost"} onClick={() => setShowSettings((v) => !v)} aria-label="Teleprompter settings" aria-pressed={showSettings} data-testid="prompter-settings-toggle">
          <Type />
        </Button>
      </div>

      {showSettings && (
        <div className="grid gap-3 border-b border-border/70 px-3 py-3 text-xs" data-testid="prompter-settings">
          <Row label="Font size" value={`${settings.fontSize}px`}>
            <Slider min={16} max={72} step={1} value={[settings.fontSize]} onValueChange={([v]) => v !== undefined && patchSettings({ fontSize: v })} aria-label="Font size" data-testid="prompter-font-size" />
          </Row>
          <Row label="Speed" value={`${settings.speed} px/s`}>
            <Slider min={5} max={200} step={1} value={[settings.speed]} onValueChange={([v]) => v !== undefined && patchSettings({ speed: v })} aria-label="Scroll speed" />
          </Row>
          <Row label="Reading line" value={`${Math.round(settings.readingLine * 100)}%`}>
            <Slider min={10} max={90} step={1} value={[Math.round(settings.readingLine * 100)]} onValueChange={([v]) => v !== undefined && patchSettings({ readingLine: v / 100 })} aria-label="Reading line position" />
          </Row>
          <Row label="Reading zone" value={`${Math.round(settings.readingZone * 100)}%`}>
            <Slider min={10} max={100} step={1} value={[Math.round(settings.readingZone * 100)]} onValueChange={([v]) => v !== undefined && patchSettings({ readingZone: v / 100 })} aria-label="Reading zone height" />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Alignment</Label>
              <Tabs value={settings.align} onValueChange={(v) => patchSettings({ align: v as "left" | "center" })}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="left">Left</TabsTrigger>
                  <TabsTrigger value="center">Centre</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="space-y-1">
              <Label>Colours</Label>
              <div className="flex items-center gap-2">
                <Input type="color" value={settings.textColor} onChange={(e) => patchSettings({ textColor: e.target.value })} className="h-7 w-9 cursor-pointer p-0.5" aria-label="Text colour" />
                <Input type="color" value={settings.backgroundColor} onChange={(e) => patchSettings({ backgroundColor: e.target.value })} className="h-7 w-9 cursor-pointer p-0.5" aria-label="Background colour" />
                <span className="text-[11px] text-muted-foreground">text / background</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center justify-between gap-2">
              Follow slides
              <Switch checked={followSlides} onCheckedChange={setFollowSlides} aria-label="Jump to the section linked to the active slide" />
            </label>
            <label className="flex items-center justify-between gap-2">
              Mirror text
              <Switch checked={settings.mirror} onCheckedChange={(c) => patchSettings({ mirror: c })} aria-label="Mirror text for a beam-splitter prompter" />
            </label>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="h-0.5 w-full bg-border/60">
        <div className="h-full bg-primary transition-[width] duration-100" style={{ width: `${pct * 100}%` }} data-testid="prompter-progress" />
      </div>

      {/* Scroller */}
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
                  paddingTop: `${settings.readingLine * 100}%`,
                  paddingBottom: `${(1 - settings.readingLine) * 100}%`,
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
                    {sec.title && (
                      <h3 className="mb-[0.3em] text-[0.6em] font-semibold uppercase tracking-[0.15em] opacity-60">
                        {sec.title}
                        {sec.slideIndex !== null && <span className="ml-2 rounded border border-current px-1 py-px text-[0.8em] opacity-70">slide {sec.slideIndex + 1}</span>}
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
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-[11px] text-muted-foreground">{value}</span>
      </div>
      {children}
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

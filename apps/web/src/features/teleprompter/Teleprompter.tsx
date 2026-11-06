/**
 * PRIVATE teleprompter controls: transport and settings around the text.
 *
 * Nothing here can reach the audience: it is DOM in the presenter window only.
 */
import { useState } from "react";
import { Gauge, Minus, Pause, PictureInPicture2, Play, Plus, RotateCcw, Square, Type } from "lucide-react";
import { Button } from "@/ui/button";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";
import { Label } from "@/ui/label";
import { Input } from "@/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
import { useScriptStore } from "@/stores/private/scriptStore";
import { MAX_SPEED, MIN_SPEED, progress, remainingSeconds } from "./scrollModel";
import { PrompterText } from "./PrompterText";
import { closeFloat, isFloatSupported, openFloat } from "./floatingWindow";
import { CAMERA_LAYOUT, layoutPatch, textLayout, type TextLayout } from "./textLayout";
import { formatDuration } from "@/lib/format";

export function Teleprompter() {
  const settings = useTeleprompterStore((s) => s.settings);
  const model = useTeleprompterStore((s) => s.model);
  const { patchSettings, toggle, stop, reset } = useTeleprompterStore.getState();
  const sections = useScriptStore((s) => s.sections);
  const [showSettings, setShowSettings] = useState(false);
  const float = useTeleprompterStore((s) => s.float);
  const [floatError, setFloatError] = useState<string | null>(null);
  // The layout controls edit whichever place is showing the text.
  const floating = float !== null;
  const layout = textLayout(settings, floating);
  const patchLayout = (p: Partial<TextLayout>) => patchSettings(layoutPatch(p, floating));

  const pct = progress(model);
  const remaining = remainingSeconds(model);
  const empty = sections.length === 0;

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
          <TooltipContent>Stop (keeps position). Esc, when the text is focused</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={reset} aria-label="Reset to top" data-testid="prompter-reset">
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset to top. Home, when the text is focused</TooltipContent>
        </Tooltip>
        <span className="mx-1 h-5 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={() => useTeleprompterStore.getState().speedDown()} aria-label="Slower" data-testid="prompter-slower">
              <Minus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Slower. ←, when the text is focused</TooltipContent>
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
          <TooltipContent>Faster. →, when the text is focused</TooltipContent>
        </Tooltip>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="prompter-remaining" title="Time remaining at this speed">
          {Number.isFinite(remaining) ? `-${formatDuration(remaining * 1000)}` : "--:--"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant={float ? "secondary" : "ghost"}
              onClick={() => {
                setFloatError(null);
                if (float) closeFloat();
                else void openFloat().then(setFloatError);
              }}
              disabled={empty && !float}
              aria-label={float ? "Bring the text back" : "Float the prompter"}
              aria-pressed={!!float}
              data-testid="prompter-float"
            >
              <PictureInPicture2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            {isFloatSupported()
              ? "Float the text in its own window, always on top. Drag it next to your camera. Viewers would see it in an entire-screen share, so share the audience window instead."
              : "Float the text in a panel you can drag next to your camera. In this browser it can't leave the browser window; in Chrome or Edge it can."}
          </TooltipContent>
        </Tooltip>
        <Button size="icon-sm" variant={showSettings ? "secondary" : "ghost"} onClick={() => setShowSettings((v) => !v)} aria-label="Teleprompter settings" aria-pressed={showSettings} data-testid="prompter-settings-toggle">
          <Type />
        </Button>
      </div>

      {showSettings && (
        <div className="grid gap-3 border-b border-border/70 px-3 py-3 text-xs" data-testid="prompter-settings">
          {floating && (
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-primary" data-testid="prompter-layout-heading">
                Floating window
              </span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => patchSettings({ ...CAMERA_LAYOUT })} data-testid="prompter-layout-reset">
                Reset to camera layout
              </Button>
            </div>
          )}
          <Row label="Font size" value={`${layout.fontSize}px`}>
            <Slider min={16} max={72} step={1} value={[layout.fontSize]} onValueChange={([v]) => v !== undefined && patchLayout({ fontSize: v })} aria-label="Font size" data-testid="prompter-font-size" />
          </Row>
          <Row label="Speed" value={`${settings.speed} px/s`}>
            <Slider min={MIN_SPEED} max={MAX_SPEED} step={1} value={[settings.speed]} onValueChange={([v]) => v !== undefined && patchSettings({ speed: v })} aria-label="Scroll speed" data-testid="prompter-speed-slider" />
          </Row>
          <Row label="Reading line" value={`${Math.round(layout.readingLine * 100)}%`}>
            <Slider min={10} max={90} step={1} value={[Math.round(layout.readingLine * 100)]} onValueChange={([v]) => v !== undefined && patchLayout({ readingLine: v / 100 })} aria-label="Reading line position" />
          </Row>
          <Row label="Reading zone" value={`${Math.round(layout.readingZone * 100)}%`}>
            <Slider min={10} max={100} step={1} value={[Math.round(layout.readingZone * 100)]} onValueChange={([v]) => v !== undefined && patchLayout({ readingZone: v / 100 })} aria-label="Reading zone height" />
          </Row>
          {floating && <p className="-mt-1 text-[11px] text-muted-foreground">Speed, colours, Follow slides and Mirror are shared with the Prompter tab.</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Alignment</Label>
              <Tabs value={layout.align} onValueChange={(v) => patchLayout({ align: v as "left" | "center" })}>
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
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-2">
                Follow slides
                <Switch checked={settings.followSlides} onCheckedChange={(c) => patchSettings({ followSlides: c })} aria-label="Jump to the section linked to the active slide" data-testid="prompter-follow" />
              </label>
              <p className="text-[11px] leading-snug text-muted-foreground" data-testid="prompter-follow-help">
                {sections.some((s) => s.slideIndex !== null) ? "When you change slide, jump to the section linked to it." : "No sections are linked yet: link one in the Script tab."}
              </p>
            </div>
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

      {floatError && (
        <p className="border-b border-border/70 px-3 py-1.5 text-xs text-destructive" role="alert" data-testid="prompter-float-error">
          {floatError}
        </p>
      )}
      {float ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground" data-testid="prompter-floating-notice">
          <p>The text is in the floating window. These controls and settings still apply to it.</p>
          <p>Drag it right under your camera, and keep it narrow: the closer the words are to the lens, the more you look at your viewers.</p>
          <Button size="sm" variant="secondary" onClick={closeFloat} data-testid="prompter-bring-back">
            Bring back
          </Button>
        </div>
      ) : (
        <PrompterText />
      )}
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

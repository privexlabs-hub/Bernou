/**
 * Active-capture indicators (driven by real MediaStreamTrack state, polled)
 * and the Emergency Stop button. Lives in the studio header so it is always
 * visible.
 */
import { useEffect, useState } from "react";
import { Camera, Mic, MonitorUp, OctagonX } from "lucide-react";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { useDevicesStore } from "@/stores/private/devicesStore";
import { emergencyStop, resumeAudience, type StopReport } from "./emergencyStop";
import { getAudiencePublisher } from "@/features/audienceWindow/AudienceWindowControls";
import { cn } from "@/lib/utils";

interface Live {
  camera: boolean;
  mic: boolean;
  audience: boolean;
}

export function useLiveCaptureState(): Live {
  const [live, setLive] = useState<Live>({ camera: false, mic: false, audience: false });
  useEffect(() => {
    const read = () => {
      const d = useDevicesStore.getState();
      const isLive = (s: MediaStream | null) => !!s && s.getTracks().some((t) => t.readyState === "live");
      const next = { camera: isLive(d.cameraStream), mic: isLive(d.micStream), audience: !!getAudiencePublisher()?.isOpen() };
      setLive((prev) => (prev.camera === next.camera && prev.mic === next.mic && prev.audience === next.audience ? prev : next));
    };
    read();
    const id = setInterval(read, 300);
    const unsub = useDevicesStore.subscribe(read);
    return () => {
      clearInterval(id);
      unsub();
    };
  }, []);
  return live;
}

export function SafetyControls() {
  const live = useLiveCaptureState();
  const [stopped, setStopped] = useState<null | StopReport>(null);
  const anyLive = live.camera || live.mic || live.audience;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Escape") {
        e.preventDefault();
        void emergencyStop().then(setStopped);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex items-center gap-2" data-testid="safety-controls">
      <div className="flex items-center gap-1 rounded-md border border-border/70 px-1.5 py-1" aria-label="Active capture sources" data-testid="capture-indicators">
        <Indicator on={live.camera} label="Camera" testId="indicator-camera">
          <Camera />
        </Indicator>
        <Indicator on={live.mic} label="Microphone" testId="indicator-mic">
          <Mic />
        </Indicator>
        <Indicator on={live.audience} label="Audience window" testId="indicator-audience">
          <MonitorUp />
        </Indicator>
      </div>
      {stopped ? (
        <div className="flex items-center gap-1" role="status" data-testid="stopped-banner">
          <span className="text-[11px] text-muted-foreground">
            Stopped — {stopped.tracksStopped} capture track{stopped.tracksStopped === 1 ? "" : "s"} ended
            {stopped.requestsCancelled > 0 && `, ${stopped.requestsCancelled} pending start${stopped.requestsCancelled === 1 ? "" : "s"} cancelled`}, audience blanked.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => {
              resumeAudience();
              setStopped(null);
            }}
            data-testid="resume-audience"
          >
            Resume audience output
          </Button>
        </div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={anyLive ? "destructive" : "outline"}
              className="h-7"
              onClick={() => void emergencyStop().then(setStopped)}
              data-testid="emergency-stop"
              aria-label="Emergency stop: end all capture and blank the audience output"
            >
              <OctagonX /> Stop all
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Ends camera, microphone and recording, blanks the audience window. <span className="kbd ml-1">Ctrl/⌘ ⇧ Esc</span>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function Indicator({ on, label, testId, children }: { on: boolean; label: string; testId: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("flex h-5 w-5 items-center justify-center rounded [&_svg]:size-3.5", on ? "text-live" : "text-muted-foreground/40")}
          data-testid={testId}
          data-on={on ? "true" : "false"}
          aria-label={`${label}: ${on ? "active" : "off"}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {label}: {on ? "active" : "off"}
      </TooltipContent>
    </Tooltip>
  );
}

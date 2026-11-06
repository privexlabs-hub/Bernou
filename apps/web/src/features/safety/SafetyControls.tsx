/**
 * Active-capture indicators (driven by real MediaStreamTrack state, polled)
 * and the Emergency Stop button. Lives in the studio header so it is always
 * visible.
 */
import { useEffect, useState } from "react";
import { Camera, Circle, Mic, MonitorUp, OctagonX } from "lucide-react";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { useDevicesStore } from "@/stores/private/devicesStore";
import { useRecordingStore, type RecordingStatus } from "@/stores/private/recordingStore";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";
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
  const recordingStatus = useRecordingStore((s) => s.status);
  const lastOutcome = useRecordingStore((s) => s.lastOutcome);
  const recording = recordingStatus === "recording";
  const anyLive = live.camera || live.mic || live.audience || recording;
  const floatWindow = useTeleprompterStore((s) => (s.float?.kind === "window" ? s.float.win : null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Escape") {
        e.preventDefault();
        void emergencyStop().then(setStopped);
      }
    };
    // A floating prompter is a window of its own: keys pressed there don't arrive here.
    const windows = floatWindow ? [window, floatWindow] : [window];
    for (const w of windows) w.addEventListener("keydown", onKey);
    return () => {
      for (const w of windows) w.removeEventListener("keydown", onKey);
    };
  }, [floatWindow]);

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
        <Indicator on={recording} label="Recording" testId="indicator-recording">
          <Circle className={recording ? "fill-rec text-rec" : undefined} />
        </Indicator>
      </div>
      {stopped ? (
        <div className="flex items-center gap-1" role="status" data-testid="stopped-banner">
          <span className="text-[11px] text-muted-foreground">
            Stopped — {stopped.tracksStopped} capture track{stopped.tracksStopped === 1 ? "" : "s"} ended
            {stopped.requestsCancelled > 0 && `, ${stopped.requestsCancelled} pending start${stopped.requestsCancelled === 1 ? "" : "s"} cancelled`}, audience blanked.
            {stopped.recording !== "none" && <span data-testid="stopped-recording"> {stopRecordingNote(stopped.recording, recordingStatus, lastOutcome)}</span>}
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

/** The report may predate the file being finished, so a pending save reads the store. */
function stopRecordingNote(reported: StopReport["recording"], status: RecordingStatus, outcome: "saved" | "failed" | null) {
  const result = reported === "saving" && status === "idle" ? outcome : reported;
  if (result === "saved") return "Recording saved.";
  if (result === "failed") return "Recording kept, but it may be incomplete.";
  return "Saving recording…";
}

function Indicator({ on, label, testId, children }: { on: boolean; label: string; testId: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("flex h-5 w-5 cursor-default items-center justify-center rounded [&_svg]:size-3.5", on ? "text-live" : "text-muted-foreground/40")}
          data-testid={testId}
          data-on={on ? "true" : "false"}
          aria-label={`${label}: ${on ? "active" : "off"}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {label}: {on ? "active" : "off"}
        {!on && (label === "Camera" || label === "Microphone") && <> — turn it on in the bottom toolbar</>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Toolbar control for the audience-only window, plus the "how to share it"
 * help. The publisher lives for the lifetime of the studio.
 */
import { useEffect, useRef, useState } from "react";
import type { AudienceCameraError } from "@bernou/audience-protocol";
import { ExternalLink, HelpCircle, MonitorUp } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { AUDIENCE_WINDOW_TITLE, createAudiencePublisher, type AudiencePublisher } from "./audiencePublisher";

const AUDIENCE_CAMERA_ERRORS: Record<AudienceCameraError, string> = {
  denied: "The audience window was blocked from the camera.",
  "in-use": "The audience window can't open the camera. Another app may be using it.",
  "not-found": "The audience window can't find the camera.",
  "not-matched": "The audience window can't tell which camera to show.",
  ended: "The audience window lost the camera.",
  unknown: "The audience window can't show the camera.",
};

/** Module-level singleton so the emergency stop (2.10) can reach it. */
let activePublisher: AudiencePublisher | null = null;
export function getAudiencePublisher() {
  return activePublisher;
}

export function AudienceWindowControls() {
  const pub = useRef<AudiencePublisher | null>(null);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [cameraError, setCameraError] = useState<AudienceCameraError | null>(null);

  useEffect(() => {
    pub.current = createAudiencePublisher(setOpen, setCameraError);
    activePublisher = pub.current;
    return () => {
      pub.current?.dispose();
      if (activePublisher === pub.current) activePublisher = null;
      pub.current = null;
    };
  }, []);

  return (
    <div className="flex items-center gap-1" data-testid="audience-window-controls">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={open ? "secondary" : "default"}
            size="sm"
            data-testid="audience-window-open"
            data-open={open ? "true" : "false"}
            onClick={() => {
              const w = pub.current?.open();
              setBlocked(!w);
            }}
          >
            {open ? <MonitorUp className="text-live" /> : <ExternalLink />}
            {open ? "Audience window open" : "Open audience window"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{open ? "Click to bring it to the front" : "Opens the clean output in its own window — share that window in Zoom, Meet or Teams"}</TooltipContent>
      </Tooltip>
      {open && (
        <Button variant="ghost" size="sm" className="px-2 text-xs" onClick={() => pub.current?.close()} data-testid="audience-window-close">
          Close
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" onClick={() => setHelp(true)} aria-label="How to share the audience window" data-testid="audience-window-help">
        <HelpCircle />
      </Button>
      {cameraError && (
        <span className="max-w-64 text-[11px] leading-tight text-destructive" role="alert" data-testid="audience-camera-error">
          {AUDIENCE_CAMERA_ERRORS[cameraError]} Turn the camera off and on to retry.
        </span>
      )}
      {blocked && (
        <span className="text-[11px] text-destructive" role="alert" data-testid="audience-window-blocked">
          Popup blocked — allow popups for this site and try again.
        </span>
      )}

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sharing the audience window in a meeting</DialogTitle>
            <DialogDescription>The audience window shows only the composed output. Share that window — never your whole screen.</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Click <strong>Open audience window</strong>. A separate window titled “{AUDIENCE_WINDOW_TITLE}” appears. Move it to any screen; double-click it for fullscreen.</li>
            <li>In Zoom, Google Meet or Microsoft Teams, start screen sharing and choose the <strong>Window</strong> (not “Screen”) option.</li>
            <li>Pick “{AUDIENCE_WINDOW_TITLE}”. Keep this studio window for your script, notes and controls.</li>
            <li>Keep the audience window open (not minimised) while sharing; some systems pause minimised windows.</li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Your microphone goes through the meeting app's own microphone setting. Bernou's audience window carries video only, so there is no echo.
            On macOS, the meeting app (or your browser, for web meetings) needs Screen Recording permission in System Settings.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Camera + microphone controls for the bottom toolbar: on/off, device
 * pickers, live indicators, level meter, mute, and permission error guidance.
 * Everything here is presenter-only.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CameraOff, Mic, MicOff } from "lucide-react";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { selectCameraLive, selectMicLive, useDevicesStore } from "@/stores/private/devicesStore";
import { cn } from "@/lib/utils";

export function MediaControls() {
  const cameras = useDevicesStore((s) => s.cameras);
  const microphones = useDevicesStore((s) => s.microphones);
  const selectedCameraId = useDevicesStore((s) => s.selectedCameraId);
  const selectedMicId = useDevicesStore((s) => s.selectedMicId);
  const cameraLive = useDevicesStore(selectCameraLive);
  const micLive = useDevicesStore(selectMicLive);
  const cameraBusy = useDevicesStore((s) => s.cameraBusy);
  const micBusy = useDevicesStore((s) => s.micBusy);
  const cameraError = useDevicesStore((s) => s.cameraError);
  const micError = useDevicesStore((s) => s.micError);
  const micMuted = useDevicesStore((s) => s.micMuted);
  const { startCamera, stopCamera, startMic, stopMic, setMicMuted, refreshDevices, _listen } = useDevicesStore.getState();

  useEffect(() => {
    void refreshDevices();
    return _listen();
  }, [refreshDevices, _listen]);

  return (
    <div className="flex items-center gap-2" data-testid="media-controls">
      {/* Camera */}
      <div className="flex items-center gap-1 rounded-md border border-border/70 bg-panel p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={cameraLive ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={cameraLive}
              aria-label={cameraLive ? "Turn camera off" : "Turn camera on"}
              data-testid="camera-toggle"
              data-live={cameraLive ? "true" : "false"}
              disabled={cameraBusy}
              onClick={() => (cameraLive ? stopCamera() : void startCamera())}
            >
              {cameraLive ? <Camera className="text-live" /> : <CameraOff />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{cameraLive ? "Camera is live — click to turn off" : "Turn camera on"}</TooltipContent>
        </Tooltip>
        <Select
          // Empty while off: Select only reports changes, so picking the camera
          // that's already selected would otherwise do nothing.
          value={cameraLive ? (selectedCameraId ?? "") : ""}
          onValueChange={(value) => {
            const id = deviceIdFromItem(value);
            useDevicesStore.setState({ selectedCameraId: id });
            void startCamera(id);
          }}
        >
          <SelectTrigger className="h-7 w-44 border-transparent bg-transparent" aria-label="Camera" data-testid="camera-select">
            <SelectValue placeholder="Choose camera" />
          </SelectTrigger>
          <SelectContent>
            {cameras.length === 0 && (
              <SelectItem value="__none" disabled>
                No camera found
              </SelectItem>
            )}
            {cameras.map((c, i) => (
              <SelectItem key={itemValue(c.deviceId, i)} value={itemValue(c.deviceId, i)}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {cameraError && <ErrorBadge message={cameraError.message} testId="camera-error" />}
      </div>

      {/* Microphone */}
      <div className="flex items-center gap-1 rounded-md border border-border/70 bg-panel p-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={micLive ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={micLive}
              aria-label={micLive ? "Turn microphone off" : "Turn microphone on"}
              data-testid="mic-toggle"
              data-live={micLive ? "true" : "false"}
              disabled={micBusy}
              onClick={() => (micLive ? stopMic() : void startMic())}
            >
              {micLive ? <Mic className={micMuted ? "text-muted-foreground" : "text-live"} /> : <MicOff />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{micLive ? "Microphone is live — click to turn off" : "Turn microphone on"}</TooltipContent>
        </Tooltip>
        <Select
          value={micLive ? (selectedMicId ?? "") : ""}
          onValueChange={(value) => {
            const id = deviceIdFromItem(value);
            useDevicesStore.setState({ selectedMicId: id });
            void startMic(id);
          }}
        >
          <SelectTrigger className="h-7 w-44 border-transparent bg-transparent" aria-label="Microphone" data-testid="mic-select">
            <SelectValue placeholder="Choose microphone" />
          </SelectTrigger>
          <SelectContent>
            {microphones.length === 0 && (
              <SelectItem value="__none" disabled>
                No microphone found
              </SelectItem>
            )}
            {microphones.map((m, i) => (
              <SelectItem key={itemValue(m.deviceId, i)} value={itemValue(m.deviceId, i)}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LevelMeter active={micLive} />
        {micLive && (
          <Button
            variant={micMuted ? "destructive" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            aria-pressed={micMuted}
            data-testid="mic-mute"
            onClick={() => setMicMuted(!micMuted)}
          >
            {micMuted ? "Muted" : "Mute"}
          </Button>
        )}
        {micError && <ErrorBadge message={micError.message} testId="mic-error" />}
      </div>
    </div>
  );
}

function ErrorBadge({ message, testId }: { message: string; testId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex h-7 items-center px-1.5 text-destructive" role="alert" data-testid={testId} aria-label={message}>
          <AlertTriangle className="h-4 w-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{message}</TooltipContent>
    </Tooltip>
  );
}

/** 12-segment audio level meter driven by the audio graph's analyser. */
export function LevelMeter({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    const tick = () => {
      const g = useDevicesStore.getState().audioGraph;
      setLevel(g ? g.level() : 0);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active]);
  const segs = 12;
  const lit = Math.round(level * segs);
  return (
    <div className="flex h-7 items-center gap-[2px] px-1" aria-label="Microphone level" data-testid="mic-level" data-level={level.toFixed(2)}>
      {Array.from({ length: segs }, (_, i) => (
        <span
          key={i}
          className={cn("block h-3 w-[3px] rounded-sm transition-colors", i < lit ? (i >= segs - 2 ? "bg-rec" : i >= segs - 5 ? "bg-primary" : "bg-live") : "bg-border")}
        />
      ))}
    </div>
  );
}

/**
 * Until the first permission grant browsers report empty device ids, which
 * Select can't tell apart or report as a change. Such an item means "whichever
 * device the browser offers".
 */
const UNNAMED_DEVICE = "__unnamed-";
const itemValue = (deviceId: string, index: number) => deviceId || `${UNNAMED_DEVICE}${index}`;
const deviceIdFromItem = (value: string) => (value.startsWith(UNNAMED_DEVICE) ? null : value);

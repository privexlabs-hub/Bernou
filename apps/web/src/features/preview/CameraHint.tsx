/**
 * Presenter-only notice over the preview: DOM, so it never reaches the canvas
 * pixels, and every state comes with the action that resolves it.
 */
import { Button } from "@/ui/button";
import { useCompositionStore } from "@/stores/public/compositionStore";
import { selectCameraLive, useDevicesStore } from "@/stores/private/devicesStore";
import { cameraHint } from "./cameraHintKind";

export function CameraHint({ stalled }: { stalled: boolean }) {
  const layout = useCompositionStore((s) => s.layout);
  const setLayout = useCompositionStore((s) => s.setLayout);
  const live = useDevicesStore(selectCameraLive);
  const busy = useDevicesStore((s) => s.cameraBusy);
  const error = useDevicesStore((s) => s.cameraError);
  const label = useDevicesStore((s) => s.cameras.find((c) => c.deviceId === s.selectedCameraId)?.label);
  const startCamera = useDevicesStore((s) => s.startCamera);

  const kind = cameraHint({ layout, live, busy, hasError: !!error, stalled });
  if (!kind) return null;

  const start = () => void startCamera();
  const { message, action, onAction } = {
    off: { message: "Camera is off", action: "Turn camera on", onAction: start },
    hidden: { message: "Camera is on but hidden by Slide only", action: "Show camera", onAction: () => setLayout("slide-with-camera") },
    error: { message: error?.message ?? "", action: "Retry", onAction: start },
    stalled: { message: `No picture from ${label ?? "the camera"}. Restart it, or choose another camera below.`, action: "Restart camera", onAction: start },
  }[kind];

  return (
    <div
      className="absolute right-2 top-2 z-10 flex max-w-[70%] items-center gap-2 rounded-md border border-border/70 bg-panel px-2.5 py-1.5 text-xs text-foreground shadow-md"
      role={kind === "error" ? "alert" : "status"}
      data-testid="camera-hint"
      data-kind={kind}
    >
      <span>{message}</span>
      <Button size="sm" variant="secondary" className="h-6 shrink-0 px-2 text-xs" onClick={onAction} data-testid="camera-hint-action">
        {action}
      </Button>
    </div>
  );
}

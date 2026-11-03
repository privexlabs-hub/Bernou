/**
 * Right-panel "Camera" section: the private raw camera preview plus the
 * overlay appearance controls (shape, size, border, mirror, shadow, corner
 * presets). Appearance values are public and flow to the audience via the
 * composition store; the raw preview itself is presenter-only.
 */
import { useEffect, useRef } from "react";
import { Button } from "@/ui/button";
import { Label } from "@/ui/label";
import { Slider } from "@/ui/slider";
import { Switch } from "@/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { useCompositionStore } from "@/stores/public/compositionStore";
import { selectCameraLive, useDevicesStore } from "@/stores/private/devicesStore";
import { Input } from "@/ui/input";

const CORNERS: Array<{ id: "tl" | "tr" | "bl" | "br"; label: string }> = [
  { id: "tl", label: "Top left" },
  { id: "tr", label: "Top right" },
  { id: "bl", label: "Bottom left" },
  { id: "br", label: "Bottom right" },
];

export function CameraPanel() {
  const stream = useDevicesStore((s) => s.cameraStream);
  const live = useDevicesStore(selectCameraLive);
  const camera = useCompositionStore((s) => s.camera);
  const layout = useCompositionStore((s) => s.layout);
  const profile = useCompositionStore((s) => s.profile);
  const patchCamera = useCompositionStore((s) => s.patchCamera);
  const setLayout = useCompositionStore((s) => s.setLayout);
  const videoRef = useRef<HTMLVideoElement>(null);
  const busy = useDevicesStore((s) => s.cameraBusy);
  const startCamera = useDevicesStore((s) => s.startCamera);
  const stopCamera = useDevicesStore((s) => s.stopCamera);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream]);

  const snapTo = (corner: "tl" | "tr" | "bl" | "br") => {
    const m = 0.03;
    const aspect = camera.shape === "circle" ? 1 : camera.aspect;
    const outW = profile === "480p" ? 854 : profile === "720p" ? 1280 : 1920;
    const outH = profile === "480p" ? 480 : profile === "720p" ? 720 : 1080;
    const h = ((camera.size * outW) / aspect / outH) as number;
    const x = corner.endsWith("l") ? m : 1 - camera.size - m;
    const y = corner.startsWith("t") ? m * (outW / outH) : 1 - h - m * (outW / outH);
    patchCamera({ x, y });
  };

  return (
    <div className="space-y-4 p-3" data-testid="camera-panel">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="panel-title">Camera preview (private)</span>
          <div className="flex items-center gap-2">
            {live && <span className="flex items-center gap-1 text-[10px] text-live">● live</span>}
            <Button size="sm" variant={live ? "secondary" : "default"} className="h-6 px-2 text-xs" disabled={busy} onClick={() => (live ? stopCamera() : void startCamera())} data-testid="camera-panel-toggle">
              {live ? "Turn off" : "Turn on"}
            </Button>
          </div>
        </div>
        <div className="aspect-video overflow-hidden rounded-md border border-border/70 bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" style={{ transform: camera.mirror ? "scaleX(-1)" : undefined }} data-testid="camera-raw-preview" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Layout</Label>
        <Tabs value={layout} onValueChange={(v) => setLayout(v as typeof layout)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="slide-with-camera" data-testid="layout-slide-with-camera">
              Slide + cam
            </TabsTrigger>
            <TabsTrigger value="slide-full" data-testid="layout-slide-full">
              Slide only
            </TabsTrigger>
            <TabsTrigger value="camera-full" data-testid="layout-camera-full">
              Camera only
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="space-y-1.5">
        <Label>Shape</Label>
        <Tabs value={camera.shape} onValueChange={(v) => patchCamera({ shape: v as "circle" | "rect" })}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="circle" data-testid="shape-circle">
              Circle
            </TabsTrigger>
            <TabsTrigger value="rect" data-testid="shape-rect">
              Rectangle
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Size</Label>
          <span className="font-mono text-[11px] text-muted-foreground">{Math.round(camera.size * 100)}%</span>
        </div>
        <Slider min={6} max={60} step={1} value={[Math.round(camera.size * 100)]} onValueChange={([v]) => v !== undefined && patchCamera({ size: v / 100 })} aria-label="Camera overlay size" data-testid="camera-size" />
      </div>

      <div className="space-y-1.5">
        <Label>Position</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {CORNERS.map((c) => (
            <Button key={c.id} variant="outline" size="sm" onClick={() => snapTo(c.id)} data-testid={`snap-${c.id}`}>
              {c.label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">Or drag the overlay on the preview; drag its corner to resize.</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Border</Label>
          <span className="font-mono text-[11px] text-muted-foreground">{camera.borderWidth}px</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={16} step={1} value={[camera.borderWidth]} onValueChange={([v]) => v !== undefined && patchCamera({ borderWidth: v })} aria-label="Border width" className="flex-1" />
          <Input type="color" value={camera.borderColor} onChange={(e) => patchCamera({ borderColor: e.target.value })} className="h-7 w-9 cursor-pointer p-0.5" aria-label="Border colour" />
        </div>
      </div>

      {camera.shape === "rect" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Corner radius</Label>
            <span className="font-mono text-[11px] text-muted-foreground">{Math.round(camera.cornerRadius * 100)}%</span>
          </div>
          <Slider min={0} max={50} step={1} value={[Math.round(camera.cornerRadius * 100)]} onValueChange={([v]) => v !== undefined && patchCamera({ cornerRadius: v / 100 })} aria-label="Corner radius" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center justify-between gap-2 text-xs">
          Mirror
          <Switch checked={camera.mirror} onCheckedChange={(c) => patchCamera({ mirror: c })} aria-label="Mirror camera" />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs">
          Shadow
          <Switch checked={camera.shadow} onCheckedChange={(c) => patchCamera({ shadow: c })} aria-label="Shadow" />
        </label>
      </div>
    </div>
  );
}

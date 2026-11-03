/**
 * Decides what, if anything, the presenter needs to be told about the camera.
 * Pure so every combination can be tested. Choosing a layout never starts the
 * camera (that would put the presenter on air without a deliberate action), so
 * the hint is what connects a layout to the action it needs.
 */
export type CameraHintKind = "off" | "hidden" | "error" | "stalled";

export function cameraHint(s: { layout: string; live: boolean; busy: boolean; hasError: boolean; stalled: boolean }): CameraHintKind | null {
  if (s.busy) return null;
  if (s.live) {
    if (s.layout === "slide-full") return "hidden";
    return s.stalled && s.layout !== "blank" ? "stalled" : null;
  }
  if (s.hasError) return "error";
  return s.layout === "slide-with-camera" || s.layout === "camera-full" ? "off" : null;
}

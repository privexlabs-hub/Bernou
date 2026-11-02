/**
 * Turns the live camera MediaStream into a FrameSource for the engine by
 * binding it to an off-DOM <video>. Re-created whenever the stream changes.
 */
import { useEffect, useState } from "react";
import { attachStreamToVideo, videoFrameSource, type FrameSource } from "@bernou/composition-engine";
import { useDevicesStore } from "@/stores/private/devicesStore";

export function useCameraSource(): { source: FrameSource | null; video: HTMLVideoElement | null } {
  const stream = useDevicesStore((s) => s.cameraStream);
  const [state, setState] = useState<{ source: FrameSource | null; video: HTMLVideoElement | null }>({ source: null, video: null });

  useEffect(() => {
    if (!stream) {
      setState({ source: null, video: null });
      return;
    }
    let cancelled = false;
    const video = document.createElement("video");
    void attachStreamToVideo(stream, video).then(() => {
      if (cancelled) return;
      setState({ source: videoFrameSource(video), video });
    });
    return () => {
      cancelled = true;
      video.pause();
      video.srcObject = null;
      setState({ source: null, video: null });
    };
  }, [stream]);

  return state;
}

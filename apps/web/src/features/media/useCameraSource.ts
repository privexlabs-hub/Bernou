/**
 * Turns the live camera MediaStream into a FrameSource for the engine by
 * binding it to an off-DOM <video>. Re-created whenever the stream changes.
 */
import { useEffect, useState } from "react";
import { attachStreamToVideo, videoFrameSource, type FrameSource } from "@bernou/composition-engine";
import { useDevicesStore } from "@/stores/private/devicesStore";

/** Seconds without a new frame before the camera counts as stalled. */
const STALL_AFTER_S = 3;

export function useCameraSource(): { source: FrameSource | null; video: HTMLVideoElement | null; stalled: boolean } {
  const stream = useDevicesStore((s) => s.cameraStream);
  const [state, setState] = useState<{ source: FrameSource | null; video: HTMLVideoElement | null }>({ source: null, video: null });
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    setStalled(false);
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
    // currentTime is the one signal that also moves for an off-DOM video.
    let lastTime = -1;
    let frozenFor = 0;
    const watch = setInterval(() => {
      frozenFor = video.currentTime === lastTime ? frozenFor + 1 : 0;
      lastTime = video.currentTime;
      setStalled(frozenFor >= STALL_AFTER_S);
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(watch);
      video.pause();
      video.srcObject = null;
      setState({ source: null, video: null });
    };
  }, [stream]);

  return { ...state, stalled };
}

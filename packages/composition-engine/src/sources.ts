/**
 * FrameSource adapters.
 */
import type { FrameSource } from "./types";

/** Wraps a <video> playing a MediaStream. Ready once it has intrinsic dimensions. */
export function videoFrameSource(video: HTMLVideoElement): FrameSource {
  return {
    current: () => (video.readyState >= 2 && video.videoWidth > 0 ? video : null),
    width: () => video.videoWidth,
    height: () => video.videoHeight,
  };
}

/** A static image as a frame source (tests, "camera off" placeholders). */
export function staticFrameSource(img: CanvasImageSource, width: number, height: number): FrameSource {
  return { current: () => img, width: () => width, height: () => height };
}

/** Create a muted, inline <video> bound to a stream and start it. */
export async function attachStreamToVideo(stream: MediaStream, video: HTMLVideoElement = document.createElement("video")): Promise<HTMLVideoElement> {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  // play() may never settle (or fail) for a video off the page. It isn't what
  // decides readiness: videoFrameSource checks each frame, so don't wait forever.
  await Promise.race([video.play().catch(() => undefined), new Promise((r) => setTimeout(r, 2000))]);
  if (video.videoWidth === 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("loadedmetadata", done);
        resolve();
      };
      video.addEventListener("loadedmetadata", done);
      setTimeout(done, 2000);
    });
  }
  return video;
}

/**
 * The live preview's canvas and a way to redraw it, for the recorder.
 * Module-level because the toolbar that starts a recording is a sibling of the
 * preview, not a child.
 */
export interface PreviewHandle {
  canvas: HTMLCanvasElement;
  draw: () => void;
  /**
   * For a recording: the preview's own loop pauses and every `draw` renders, so
   * each frame is drawn once, fresh, by the recorder's clock. Returns the release.
   */
  capture: () => () => void;
}

interface DrawableEngine {
  frameCount(): number;
  renderNow(): void;
  start(): void;
  stop(): void;
}

/**
 * The recorder's draw. Outside a recording it only fills in when the preview's
 * loop hasn't drawn since last time. During one, the loop is paused: both
 * drawing each frame doubled the main thread's work, and recordings stuttered
 * on a busy machine.
 */
export function createPreviewDraw(eng: DrawableEngine) {
  let lastFrame = -1;
  let capturing = false;
  let disposed = false;
  return {
    draw: () => {
      if (capturing || eng.frameCount() === lastFrame) eng.renderNow();
      lastFrame = eng.frameCount();
    },
    capture: () => {
      capturing = true;
      eng.stop();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        capturing = false;
        if (!disposed) eng.start();
      };
    },
    dispose: () => {
      disposed = true;
    },
  };
}

let handle: PreviewHandle | null = null;

export const setPreviewHandle = (h: PreviewHandle | null) => {
  handle = h;
};
export const getPreviewHandle = () => handle;

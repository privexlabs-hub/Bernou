/**
 * The live preview's canvas and a way to redraw it, for the recorder.
 * Module-level because the toolbar that starts a recording is a sibling of the
 * preview, not a child.
 */
export interface PreviewHandle {
  canvas: HTMLCanvasElement;
  draw: () => void;
}

let handle: PreviewHandle | null = null;

export const setPreviewHandle = (h: PreviewHandle | null) => {
  handle = h;
};
export const getPreviewHandle = () => handle;

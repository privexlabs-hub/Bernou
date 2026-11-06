/**
 * Opens and closes the floating prompter.
 *
 * Where the browser has Document Picture-in-Picture, it's a real always-on-top
 * window the presenter can drag to the camera. The browser decides where it
 * opens and remembers where it was dragged; a page can't set that. Elsewhere
 * it's a panel that can move only inside the browser window.
 */
import { registerStopper } from "@/features/safety/emergencyStop";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

// Small, so the words stay close to the camera and the eyes sweep less.
const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 200;

function pictureInPicture(): DocumentPictureInPicture | null {
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture ?? null;
}

export function isFloatSupported(): boolean {
  return pictureInPicture() !== null;
}

/**
 * The new window starts blank: it needs the page's styles to look like the app.
 * Resolves once they've loaded. Measured without them, the text has no scroll
 * box, and its height feeds its own padding, which loses the reading place.
 */
function copyStyles(win: Window): Promise<unknown> {
  const loading: Promise<void>[] = [];
  for (const el of document.head.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')) {
    const copy = win.document.importNode(el, true);
    if (el instanceof HTMLLinkElement) {
      copy.setAttribute("href", el.href);
      loading.push(
        new Promise((resolve) => {
          copy.addEventListener("load", () => resolve(), { once: true });
          copy.addEventListener("error", () => resolve(), { once: true }); // unstyled beats no prompter
        }),
      );
    }
    win.document.head.append(copy);
  }
  win.document.documentElement.className = document.documentElement.className;
  win.document.body.className = document.body.className;
  return Promise.all(loading);
}

/** Call directly from a click: the browser refuses without one. Returns an error to show, or null. */
export async function openFloat(): Promise<string | null> {
  const { float, setFloat } = useTeleprompterStore.getState();
  if (float) return null;
  const pip = pictureInPicture();
  if (!pip) {
    setFloat({ kind: "panel" });
    return null;
  }
  try {
    const win = await pip.requestWindow({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    win.document.title = "Bernou prompter (private)";
    let closed = false;
    win.addEventListener("pagehide", () => {
      closed = true;
      const current = useTeleprompterStore.getState().float;
      if (current?.kind === "window" && current.win === win) setFloat(null);
    });
    await copyStyles(win);
    if (closed) return null;
    setFloat({ kind: "window", win });
    win.focus();
    return null;
  } catch {
    return "The browser wouldn't open the floating window. Click Float to try again.";
  }
}

export function closeFloat() {
  const { float, setFloat } = useTeleprompterStore.getState();
  if (!float) return;
  setFloat(null);
  if (float.kind === "window") float.win.close();
}

// The one Bernou surface that can sit over other apps, so Stop all takes it down too.
registerStopper(closeFloat);

export interface PanelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_PANEL_WIDTH = 240;
export const MIN_PANEL_HEIGHT = 140;
const PANEL_KEY = "bernou-float-panel";

/** Keeps the panel reachable: never bigger than the window, never outside it. */
export function clampPanelBox(box: PanelBox, viewportWidth: number, viewportHeight: number): PanelBox {
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(box.width, viewportWidth));
  const height = Math.max(MIN_PANEL_HEIGHT, Math.min(box.height, viewportHeight));
  return {
    width,
    height,
    x: Math.max(0, Math.min(box.x, viewportWidth - width)),
    y: Math.max(0, Math.min(box.y, viewportHeight - height)),
  };
}

/** Top centre, where a laptop's camera usually is, unless it has been moved before. */
export function loadPanelBox(viewportWidth: number, viewportHeight: number): PanelBox {
  let saved: Partial<PanelBox> = {};
  try {
    saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? "{}") as Partial<PanelBox>;
  } catch {
    /* blocked or corrupt storage: the default place is fine */
  }
  const width = Number.isFinite(saved.width) ? saved.width! : WINDOW_WIDTH;
  const height = Number.isFinite(saved.height) ? saved.height! : WINDOW_HEIGHT;
  const x = Number.isFinite(saved.x) ? saved.x! : (viewportWidth - width) / 2;
  const y = Number.isFinite(saved.y) ? saved.y! : 8;
  return clampPanelBox({ x, y, width, height }, viewportWidth, viewportHeight);
}

export function savePanelBox(box: PanelBox) {
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify(box));
  } catch {
    /* only a convenience */
  }
}

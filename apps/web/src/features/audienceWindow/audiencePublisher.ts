/**
 * Presenter-side publisher for the audience window.
 *
 * - Opens /audience.html in a separate window (user gesture required).
 * - Broadcasts the AudiencePayload on every public-state change.
 * - Answers `hello` with the current payload and `asset-request` with the
 *   rasterised slide Blob — and nothing else. It reads ONLY public stores.
 */
import { AudienceChannel, type AudiencePayload } from "@bernou/audience-protocol";
import { buildCurrentAudiencePayload, subscribeAudiencePayload } from "@/stores/audienceBridge";
import { useDeckStore } from "@/stores/public/deckStore";

export const AUDIENCE_WINDOW_NAME = "bernou-audience";
export const AUDIENCE_WINDOW_TITLE = "Bernou — Audience";

export interface AudiencePublisher {
  /** Open (or focus) the audience window. Must be called from a user gesture. */
  open(): Window | null;
  focus(): void;
  close(): void;
  isOpen(): boolean;
  /** Push a blank frame (emergency stop) without closing. */
  blank(): void;
  /** Resume publishing after blank(). */
  resume(): void;
  /** Number of audience windows that said hello since start (diagnostics). */
  hellos(): number;
  dispose(): void;
}

export function createAudiencePublisher(onState?: (open: boolean) => void): AudiencePublisher {
  const channel = new AudienceChannel("presenter");
  let win: Window | null = null;
  let blanked = false;
  let latest: AudiencePayload | null = null;
  let hellos = 0;

  const publish = (p: AudiencePayload) => {
    latest = p;
    if (!blanked) channel.send({ type: "payload", payload: p });
  };
  const unsubscribe = subscribeAudiencePayload(publish);

  channel.onMessage((m) => {
    if (m.type === "hello") {
      hellos++;
      if (!blanked) channel.send({ type: "payload", payload: latest ?? buildCurrentAudiencePayload() });
      else channel.send({ type: "blank" });
    } else if (m.type === "asset-request") {
      // Serve ONLY slide bitmaps that exist in the public deck store.
      const slide = useDeckStore.getState().slides.find((s) => s.assetId === m.assetId);
      if (slide) channel.send({ type: "asset", assetId: slide.assetId, mime: slide.mime, blob: slide.blob, width: slide.width, height: slide.height });
    }
  });

  const poll = setInterval(() => {
    if (win && win.closed) {
      win = null;
      onState?.(false);
    }
  }, 500);

  return {
    open() {
      if (win && !win.closed) {
        win.focus();
        return win;
      }
      // A plain popup with minimal chrome. Size 16:9 so screen-sharing it looks right.
      const features = "popup=yes,width=1280,height=760,menubar=no,toolbar=no,location=no,status=no";
      win = window.open("/audience.html", AUDIENCE_WINDOW_NAME, features);
      if (win) onState?.(true);
      return win;
    },
    focus: () => win?.focus(),
    close() {
      win?.close();
      win = null;
      onState?.(false);
    },
    isOpen: () => !!win && !win.closed,
    blank() {
      blanked = true;
      channel.send({ type: "blank" });
    },
    resume() {
      blanked = false;
      channel.send({ type: "payload", payload: latest ?? buildCurrentAudiencePayload() });
    },
    hellos: () => hellos,
    dispose() {
      clearInterval(poll);
      unsubscribe();
      try {
        channel.send({ type: "bye" });
      } catch {
        /* closed */
      }
      channel.close();
    },
  };
}

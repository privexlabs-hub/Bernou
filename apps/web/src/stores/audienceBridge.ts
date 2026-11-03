/**
 * THE AUDIENCE BRIDGE — the only place in the presenter app that may build an
 * AudiencePayload (enforced by .dependency-cruiser.cjs rule
 * "only-audience-bridge-builds-payload").
 *
 * It reads ONLY from the public stores (deck, composition). It must never
 * import from stores/private or any feature module. Review every change to
 * this file against docs/PRIVACY_MODEL.md.
 */
import { buildAudiencePayload } from "@bernou/audience-protocol/build";
import type { AudiencePayload } from "@bernou/audience-protocol";
import { useDeckStore, selectActiveSlide } from "./public/deckStore";
import { useCompositionStore } from "./public/compositionStore";

// From the clock, not 0: an audience window outlives a presenter reload and
// ignores anything not newer than what it last saw.
let seq = Date.now();

/** Build the payload from the current public state. Pure apart from `seq`. */
export function buildCurrentAudiencePayload(): AudiencePayload {
  const deck = useDeckStore.getState();
  const comp = useCompositionStore.getState();
  const slide = selectActiveSlide(deck);
  seq += 1;
  return buildAudiencePayload({
    seq,
    profile: comp.profile,
    background: comp.background,
    layout: comp.layout,
    slide: slide ? { assetId: slide.assetId, width: slide.width, height: slide.height } : null,
    camera: {
      enabled: comp.camera.enabled,
      deviceId: comp.cameraDeviceId,
      shape: comp.camera.shape,
      x: comp.camera.x,
      y: comp.camera.y,
      size: comp.camera.size,
      aspect: comp.camera.aspect,
      cornerRadius: comp.camera.cornerRadius,
      borderWidth: comp.camera.borderWidth,
      borderColor: comp.camera.borderColor,
      shadow: comp.camera.shadow,
      mirror: comp.camera.mirror,
      opacity: comp.camera.opacity,
    },
    branding: comp.branding.enabled && comp.branding.title.trim()
      ? { title: comp.branding.title.trim(), logoAssetId: null, position: comp.branding.position, color: comp.branding.color }
      : null,
  });
}

/**
 * Subscribe to public-state changes and receive a fresh payload, coalesced to
 * one per animation frame. Used by the preview, the audience-window
 * publisher and (later) the recorder.
 */
export function subscribeAudiencePayload(listener: (p: AudiencePayload) => void): () => void {
  let scheduled = false;
  const emit = () => {
    if (!scheduled) return;
    scheduled = false;
    listener(buildCurrentAudiencePayload());
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // A hidden tab has no animation frames and throttles timers to about a
    // second, so don't wait for either: there's nothing to coalesce for anyway.
    if (typeof requestAnimationFrame !== "function" || document.hidden) queueMicrotask(emit);
    else requestAnimationFrame(emit);
  };
  const u1 = useDeckStore.subscribe(schedule);
  const u2 = useCompositionStore.subscribe(schedule);
  listener(buildCurrentAudiencePayload());
  return () => {
    u1();
    u2();
  };
}

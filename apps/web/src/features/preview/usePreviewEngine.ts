/**
 * Runs the composition engine on the preview canvas. The same engine code
 * runs in the audience window; this hook only wires React to it.
 */
import { useEffect, useRef, useState } from "react";
import { createAssetCache, createEngine, type Engine, type FrameSource } from "@bernou/composition-engine";
import type { AudiencePayload } from "@bernou/audience-protocol";
import { createPreviewDraw, setPreviewHandle } from "./previewHandle";
import { subscribeAudiencePayload } from "@/stores/audienceBridge";
import { useDeckStore } from "@/stores/public/deckStore";

export interface PreviewEngineHandle {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  payload: AudiencePayload | null;
  engine: Engine | null;
}

function sameExceptInk(a: AudiencePayload, b: AudiencePayload) {
  return a.layout === b.layout && a.slide?.assetId === b.slide?.assetId && a.output.width === b.output.width && a.output.height === b.output.height && JSON.stringify(a.camera) === JSON.stringify(b.camera);
}

/** How far either side of the current slide to keep ready, so changing slide is instant. */
const NEARBY_SLIDES = 3;

export function usePreviewEngine(cameraSource: FrameSource | null): PreviewEngineHandle {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [payload, setPayload] = useState<AudiencePayload | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);

  // Engine lifetime
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cache = createAssetCache();
    const eng = createEngine(canvas, { assets: cache });
    engineRef.current = eng;
    setEngine(eng);
    const previewDraw = createPreviewDraw(eng);
    setPreviewHandle({ canvas, draw: previewDraw.draw, capture: previewDraw.capture });

    // Decode what's on screen and what's next to it, on demand. The cache can't
    // hold every slide of a large deck, and whatever it drops has to come back.
    const decoding = new Set<string>();
    const syncAssets = () => {
      const { slides, activeIndex } = useDeckStore.getState();
      for (let i = activeIndex - NEARBY_SLIDES; i <= activeIndex + NEARBY_SLIDES; i++) {
        const s = slides[i];
        if (!s || cache.has(s.assetId) || decoding.has(s.assetId)) continue;
        decoding.add(s.assetId);
        void cache.put(s.assetId, s.blob).then(() => {
          decoding.delete(s.assetId);
          eng.renderNow();
        });
      }
    };
    syncAssets();
    const unsubDeck = useDeckStore.subscribe((s, p) => {
      if (s.slides !== p.slides) cache.clear();
      if (s.slides !== p.slides || s.activeIndex !== p.activeIndex) syncAssets();
    });

    const unsubPayload = subscribeAudiencePayload((p) => {
      eng.resize(p.output.width, p.output.height);
      eng.setPayload(p);
      // The UI doesn't use ink, and ink changes many times a second while drawing.
      setPayload((prev) => (prev && sameExceptInk(prev, p) ? prev : p));
    });

    eng.start();
    return () => {
      previewDraw.dispose();
      unsubPayload();
      unsubDeck();
      eng.stop();
      cache.clear();
      engineRef.current = null;
      setEngine(null);
      setPreviewHandle(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setCamera(cameraSource);
  }, [cameraSource]);

  return { canvasRef, payload, engine };
}

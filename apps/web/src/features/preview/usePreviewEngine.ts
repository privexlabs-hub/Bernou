/**
 * Runs the composition engine on the preview canvas. The same engine code
 * runs in the audience window; this hook only wires React to it.
 */
import { useEffect, useRef, useState } from "react";
import { createAssetCache, createEngine, type Engine, type FrameSource } from "@bernou/composition-engine";
import type { AudiencePayload } from "@bernou/audience-protocol";
import { subscribeAudiencePayload } from "@/stores/audienceBridge";
import { useDeckStore } from "@/stores/public/deckStore";

export interface PreviewEngineHandle {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  payload: AudiencePayload | null;
  engine: Engine | null;
}

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

    // Decode every deck slide into the cache (slides are small enough; keeps slide changes instant).
    const syncAssets = () => {
      const slides = useDeckStore.getState().slides;
      for (const s of slides) if (!cache.has(s.assetId)) void cache.put(s.assetId, s.blob).then(() => eng.renderNow());
    };
    syncAssets();
    const unsubDeck = useDeckStore.subscribe((s, p) => s.slides !== p.slides && (cache.clear(), syncAssets()));

    const unsubPayload = subscribeAudiencePayload((p) => {
      eng.resize(p.output.width, p.output.height);
      eng.setPayload(p);
      setPayload(p);
    });

    eng.start();
    return () => {
      unsubPayload();
      unsubDeck();
      eng.stop();
      cache.clear();
      engineRef.current = null;
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setCamera(cameraSource);
  }, [cameraSource]);

  return { canvasRef, payload, engine };
}

/**
 * assetId → decoded image cache. Decodes Blobs to ImageBitmap (browser) and
 * releases them on eviction. Used by both the presenter preview and the
 * audience window; the latter fills it from `asset` channel messages.
 */
import type { AssetResolver } from "./types";

export interface AssetCache extends AssetResolver {
  has(assetId: string): boolean;
  put(assetId: string, blob: Blob): Promise<void>;
  putImage(assetId: string, img: CanvasImageSource): void;
  delete(assetId: string): void;
  clear(): void;
  size(): number;
  /** Resolves once a pending decode for assetId completes (or immediately). */
  whenReady(assetId: string): Promise<void>;
}

export function createAssetCache(maxEntries = 64): AssetCache {
  const map = new Map<string, CanvasImageSource>();
  const pending = new Map<string, Promise<void>>();
  // A decode still running when the cache is cleared must not put back what it was cleared of.
  let generation = 0;

  const evictIfNeeded = () => {
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      release(map.get(oldest));
      map.delete(oldest);
    }
  };
  const release = (img: CanvasImageSource | undefined) => {
    if (img && typeof (img as ImageBitmap).close === "function") (img as ImageBitmap).close();
  };

  return {
    get: (id) => {
      const v = map.get(id) ?? null;
      if (v) {
        // LRU touch
        map.delete(id);
        map.set(id, v);
      }
      return v;
    },
    has: (id) => map.has(id),
    async put(id, blob) {
      const p = (async () => {
        const started = generation;
        const bmp = await createImageBitmap(blob);
        if (started !== generation) return bmp.close();
        release(map.get(id));
        map.set(id, bmp);
        evictIfNeeded();
      })();
      pending.set(id, p);
      try {
        await p;
      } finally {
        pending.delete(id);
      }
    },
    putImage(id, img) {
      release(map.get(id));
      map.set(id, img);
      evictIfNeeded();
    },
    delete(id) {
      release(map.get(id));
      map.delete(id);
    },
    clear() {
      generation++;
      for (const v of map.values()) release(v);
      map.clear();
    },
    size: () => map.size,
    whenReady: (id) => pending.get(id) ?? Promise.resolve(),
  };
}

/** Turns stored slides into the deck the presenter works with. */
import type { SlideRecord } from "@/db/dexie";
import type { DeckSlide } from "@/stores/public/deckStore";

/**
 * The revision changes with every replace, so a new deck gets new asset ids.
 * An audience window keeps what it has decoded, and asks only for ids it lacks.
 */
export function toDeckSlides(records: SlideRecord[], revision: number): DeckSlide[] {
  return [...records]
    .sort((a, b) => a.index - b.index)
    .map((r) => ({
      assetId: `${r.sessionId}-${revision}-${r.index}`.replace(/[^A-Za-z0-9_-]/g, ""),
      index: r.index,
      width: r.width,
      height: r.height,
      mime: r.mime,
      blob: r.blob,
      thumbUrl: URL.createObjectURL(r.thumb),
    }));
}

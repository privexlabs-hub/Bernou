/**
 * Centre panel. In step 2.4 the <img> is replaced by the composition-engine
 * canvas. Until then this shows the active slide bitmap so navigation can be
 * verified end-to-end.
 */
import { useEffect, useState } from "react";
import { useDeckStore, selectActiveSlide } from "@/stores/public/deckStore";

export function PreviewPanel() {
  const slide = useDeckStore(selectActiveSlide);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!slide) return setUrl(null);
    const u = URL.createObjectURL(slide.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [slide]);

  return (
    <section className="panel flex h-full flex-col overflow-hidden" aria-label="Audience preview">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="panel-title">Audience preview</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-2">
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full object-contain" data-testid="preview-slide" draggable={false} />
        ) : (
          <p className="text-xs text-muted-foreground">Import slides to see the audience output.</p>
        )}
      </div>
    </section>
  );
}

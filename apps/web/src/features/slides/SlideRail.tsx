import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDeckStore } from "@/stores/public/deckStore";
import { useSessionStore } from "@/stores/private/sessionStore";
import { Button } from "@/ui/button";
import { ImportPanel } from "./ImportPanel";
import { cn } from "@/lib/utils";

export function SlideRail() {
  const slides = useDeckStore((s) => s.slides);
  const active = useDeckStore((s) => s.activeIndex);
  const setActive = useDeckStore((s) => s.setActiveIndex);
  const next = useDeckStore((s) => s.next);
  const prev = useDeckStore((s) => s.prev);
  const session = useSessionStore((s) => s.session);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <aside className="panel flex h-full flex-col overflow-hidden" aria-label="Slides">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="panel-title">Slides</span>
        <span className="font-mono text-xs text-muted-foreground" data-testid="slide-counter">
          {slides.length === 0 ? "—" : `${active + 1} / ${slides.length}`}
        </span>
      </div>

      {slides.length > 0 && (
        <div className="flex items-center gap-1 px-2 pb-2">
          <Button variant="secondary" size="sm" className="flex-1" onClick={prev} disabled={active === 0} data-testid="slide-prev" aria-label="Previous slide">
            <ChevronLeft /> Prev
          </Button>
          <Button variant="secondary" size="sm" className="flex-1" onClick={next} disabled={active >= slides.length - 1} data-testid="slide-next" aria-label="Next slide">
            Next <ChevronRight />
          </Button>
        </div>
      )}

      <ol ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2" data-testid="slide-thumbs">
        {slides.map((s) => (
          <li key={s.assetId} data-index={s.index}>
            <button
              type="button"
              onClick={() => setActive(s.index)}
              aria-current={s.index === active ? "true" : undefined}
              aria-label={`Slide ${s.index + 1}`}
              className={cn(
                "group relative block w-full overflow-hidden rounded-md border bg-black/40 transition-colors",
                s.index === active ? "border-primary ring-1 ring-primary/50" : "border-border/60 hover:border-border",
              )}
            >
              <img src={s.thumbUrl} alt="" className="aspect-video w-full object-contain" draggable={false} />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[10px] text-white/90">{s.index + 1}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="border-t border-border/70 p-2">
        <ImportPanel compact={slides.length > 0} />
        {session?.sourceFileName && (
          <p className="mt-2 truncate px-1 text-[10px] text-muted-foreground" title={session.sourceFileName}>
            {session.sourceFileName}
          </p>
        )}
      </div>
    </aside>
  );
}

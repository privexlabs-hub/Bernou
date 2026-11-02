import { MediaControls } from "@/features/media/MediaControls";

/**
 * Bottom toolbar: camera + microphone controls (2.5), audience window (2.9),
 * recording controls (stage THIRD), presentation controls.
 */
export function BottomToolbar() {
  return (
    <footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border/70 px-3" data-testid="bottom-toolbar">
      <MediaControls />
      <div className="ml-auto flex items-center gap-2" id="toolbar-right" />
    </footer>
  );
}

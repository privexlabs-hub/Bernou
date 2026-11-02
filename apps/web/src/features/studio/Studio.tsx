import { useParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { TooltipProvider } from "@/ui/tooltip";
import { useSessionLoader, useSessionPersistence } from "@/features/session/useSessionLoader";
import { useSessionStore } from "@/stores/private/sessionStore";
import { StudioHeader } from "./StudioHeader";
import { SlideRail } from "@/features/slides/SlideRail";
import { PreviewPanel } from "@/features/preview/PreviewPanel";
import { RightPanel } from "./RightPanel";
import { BottomToolbar } from "./BottomToolbar";
import { useSlideShortcuts } from "@/features/slides/useSlideShortcuts";
import { Link } from "react-router-dom";

export function Studio() {
  const { sessionId } = useParams<{ sessionId: string }>();
  useSessionLoader(sessionId);
  useSessionPersistence(sessionId);
  useSlideShortcuts();

  const loading = useSessionStore((s) => s.loading);
  const loadError = useSessionStore((s) => s.loadError);

  if (loadError) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-background" data-testid="studio" data-loading={loading ? "true" : "false"}>
        <StudioHeader />
        <div className="min-h-0 flex-1 p-2">
          <PanelGroup direction="horizontal" autoSaveId="bernou-studio-h">
            <Panel defaultSize={16} minSize={10} collapsible collapsedSize={0} className="min-w-0">
              <SlideRail />
            </Panel>
            <PanelResizeHandle className="mx-1 w-1 rounded bg-transparent transition-colors hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60" />
            <Panel defaultSize={54} minSize={30} className="min-w-0">
              <PreviewPanel />
            </Panel>
            <PanelResizeHandle className="mx-1 w-1 rounded bg-transparent transition-colors hover:bg-primary/40 data-[resize-handle-active]:bg-primary/60" />
            <Panel defaultSize={30} minSize={18} collapsible collapsedSize={0} className="min-w-0">
              <RightPanel />
            </Panel>
          </PanelGroup>
        </div>
        <BottomToolbar />
      </div>
    </TooltipProvider>
  );
}

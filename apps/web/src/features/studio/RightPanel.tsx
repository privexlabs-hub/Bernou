import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { CameraPanel } from "@/features/media/CameraPanel";
import { ScriptEditor, useScriptAutosave } from "@/features/script/ScriptEditor";
import { NotesPanel } from "@/features/notes/NotesPanel";
import { Teleprompter } from "@/features/teleprompter/Teleprompter";
import { useTeleprompterShortcuts } from "@/features/teleprompter/useTeleprompterShortcuts";
import { useTeleprompterStore } from "@/stores/private/teleprompterStore";

/**
 * Right panel: Script, Teleprompter, Notes (steps 2.7–2.8) and Camera (2.5).
 */
export function RightPanel() {
  useScriptAutosave();
  useTeleprompterShortcuts();
  const [tab, setTab] = useState("script");
  const setPrompterVisible = useTeleprompterStore((s) => s.setVisible);
  useEffect(() => {
    setPrompterVisible(tab === "prompter");
    return () => setPrompterVisible(false);
  }, [tab, setPrompterVisible]);
  return (
    <aside className="panel flex h-full flex-col overflow-hidden" aria-label="Presenter tools">
      <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
        <div className="px-2 pt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="script" data-testid="tab-script">
              Script
            </TabsTrigger>
            <TabsTrigger value="prompter" data-testid="tab-prompter">
              Prompter
            </TabsTrigger>
            <TabsTrigger value="notes" data-testid="tab-notes">
              Notes
            </TabsTrigger>
            <TabsTrigger value="camera" data-testid="tab-camera">
              Camera
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <TabsContent value="script" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <ScriptEditor />
          </TabsContent>
          {/*
            Laid out even when inactive, at the size it has when active: with
            display:none it would measure 0 and lose its scroll position.
          */}
          <TabsContent value="prompter" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:invisible data-[state=inactive]:absolute data-[state=inactive]:inset-0" forceMount>
            <Teleprompter />
          </TabsContent>
          <TabsContent value="notes" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <NotesPanel />
          </TabsContent>
          <TabsContent value="camera" className="min-h-0 flex-1 overflow-y-auto">
            <CameraPanel />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

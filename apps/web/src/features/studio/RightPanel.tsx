import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { CameraPanel } from "@/features/media/CameraPanel";
import { ScriptEditor, useScriptAutosave } from "@/features/script/ScriptEditor";
import { NotesPanel } from "@/features/notes/NotesPanel";

/**
 * Right panel: Script, Teleprompter, Notes (steps 2.7–2.8) and Camera (2.5).
 */
export function RightPanel() {
  useScriptAutosave();
  return (
    <aside className="panel flex h-full flex-col overflow-hidden" aria-label="Presenter tools">
      <Tabs defaultValue="script" className="flex h-full flex-col">
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
        <TabsContent value="script" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <ScriptEditor />
        </TabsContent>
        <TabsContent value="prompter" className="min-h-0 flex-1 overflow-y-auto">
          <p className="p-4 text-center text-xs text-muted-foreground">Teleprompter arrives in step 2.8.</p>
        </TabsContent>
        <TabsContent value="notes" className="min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
          <NotesPanel />
        </TabsContent>
        <TabsContent value="camera" className="min-h-0 flex-1 overflow-y-auto">
          <CameraPanel />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

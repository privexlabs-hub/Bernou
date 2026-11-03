/** Why a PowerPoint file can't be imported directly, and how to export it. */
import { Upload } from "lucide-react";
import { PPTX_EXPORT_STEPS, PPTX_GUIDANCE_BODY, PPTX_GUIDANCE_TITLE } from "@bernou/import-core";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";

export function PptxGuidanceDialog({ open, onOpenChange, onChooseFile }: { open: boolean; onOpenChange: (open: boolean) => void; onChooseFile: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pptx-guidance">
        <DialogHeader>
          <DialogTitle>{PPTX_GUIDANCE_TITLE}</DialogTitle>
          <DialogDescription>{PPTX_GUIDANCE_BODY}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {PPTX_EXPORT_STEPS.map((s) => (
            <li key={s.app} className="rounded-md border border-border/70 bg-panel-raised p-2.5">
              <div className="text-xs font-semibold">{s.app}</div>
              <div className="text-xs text-muted-foreground">{s.steps}</div>
            </li>
          ))}
        </ul>
        <Button
          onClick={() => {
            onOpenChange(false);
            onChooseFile();
          }}
        >
          <Upload /> Choose the exported PDF
        </Button>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { getSetting, setSetting } from "@/db/repositories/settings";
import { Button } from "@/ui/button";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { eraseRecordingFiles } from "@bernou/media-core/recorder";
import { db } from "@/db/dexie";

export interface AppSettings {
  defaultProfile: "480p" | "720p" | "1080p";
  /** Ask for storage persistence when the first recording starts. */
  requestPersistentStorage: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { defaultProfile: "1080p", requestPersistentStorage: true };

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [confirmErase, setConfirmErase] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    void getSetting<AppSettings>("app", DEFAULT_APP_SETTINGS).then(setSettings);
    void (async () => {
      if (!("storage" in navigator) || !navigator.storage?.estimate) return;
      const est = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0, persisted });
    })();
  }, [open]);

  const update = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await setSetting("app", next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Bernou stores everything in this browser profile on this device.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <div className="grid gap-2">
            <Label>Default output resolution for new presentations</Label>
            <Select value={settings.defaultProfile} onValueChange={(v) => void update({ defaultProfile: v as AppSettings["defaultProfile"] })}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="480p">480p (854×480)</SelectItem>
                <SelectItem value="720p">720p (1280×720)</SelectItem>
                <SelectItem value="1080p">1080p (1920×1080)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Ask the browser to keep data persistent</Label>
              <p className="mt-1 text-xs text-muted-foreground">Reduces the chance the browser evicts your slides and scripts under storage pressure.</p>
            </div>
            <Switch checked={settings.requestPersistentStorage} onCheckedChange={(c) => void update({ requestPersistentStorage: c })} />
          </div>
          {storage && (
            <div className="rounded-md border border-border/70 bg-panel-raised p-3 text-xs text-muted-foreground">
              <div>
                Storage used: {(storage.usage / 1024 / 1024).toFixed(1)} MB of ~{(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB
              </div>
              <div>Persistent: {storage.persisted === null ? "unknown" : storage.persisted ? "yes" : "no (best-effort)"}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-border/70 pt-4">
            <div>
              <Label>Erase all Bernou data on this device</Label>
              <p className="mt-1 text-xs text-muted-foreground">Deletes every session, script, note and recording.</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmErase(true)}
            >
              Erase
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmErase}
          onOpenChange={setConfirmErase}
          title="Erase all Bernou data?"
          description="Every session, script, note and recording on this device is deleted, and the page reloads. This can't be undone."
          confirmLabel="Erase everything"
          onConfirm={async () => {
            await eraseRecordingFiles();
            await db().delete();
            location.reload();
          }}
          testId="settings-erase-confirm"
        />
      </DialogContent>
    </Dialog>
  );
}

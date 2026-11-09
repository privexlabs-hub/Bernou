/**
 * Toolbar recording control: Record / timer / Stop, the prompt when the mic is
 * off, and the review dialog with the download. All presenter-only DOM.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Circle, Download, Scissors, Square, Trash2 } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import { deleteRecording } from "@/db/repositories/recordings";
import { formatBytes, formatDuration } from "@/lib/format";
import { selectMicLive, useDevicesStore } from "@/stores/private/devicesStore";
import { useRecordingStore } from "@/stores/private/recordingStore";
import { startRecording, stopRecording } from "./recordingController";
import { downloadRecording, recordingBlob } from "./recordingFile";

export function RecordControls() {
  const status = useRecordingStore((s) => s.status);
  const startedAt = useRecordingStore((s) => s.startedAt);
  const warning = useRecordingStore((s) => s.warning);
  const error = useRecordingStore((s) => s.error);
  const micLive = useDevicesStore(selectMicLive);
  const micError = useDevicesStore((s) => s.micError);
  const micBusy = useDevicesStore((s) => s.micBusy);
  const [askMic, setAskMic] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== "recording") return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const t = setInterval(tick, 500);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", warn);
    };
  }, [status, startedAt]);

  const recording = status === "recording";
  return (
    <div className="flex items-center gap-2" data-testid="record-controls">
      {(warning || error) && (
        <span className="max-w-64 text-[11px] leading-tight text-destructive" role="alert" data-testid="record-message">
          {error ?? warning}
        </span>
      )}
      {recording && (
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-rec" data-testid="record-timer">
          <Circle className="h-2.5 w-2.5 fill-current" />
          {formatDuration(elapsed)}
        </span>
      )}
      <Button
        size="sm"
        variant={recording ? "destructive" : "secondary"}
        disabled={status === "preparing" || status === "stopping"}
        data-testid="record-toggle"
        data-status={status}
        onClick={() => {
          if (recording) void stopRecording({ quiet: false });
          else if (micLive) void startRecording();
          else setAskMic(true);
        }}
      >
        {recording ? <Square /> : <Circle className="text-rec" />}
        {recording ? "Stop recording" : status === "stopping" ? "Saving…" : "Record"}
      </Button>

      <Dialog open={askMic} onOpenChange={setAskMic}>
        <DialogContent data-testid="record-mic-prompt">
          <DialogHeader>
            <DialogTitle>Your microphone is off</DialogTitle>
            <DialogDescription>Turn it on to record your voice. You can also turn it on later: until then the recording is silent.</DialogDescription>
          </DialogHeader>
          {micError && (
            <p className="text-sm text-destructive" role="alert">
              {micError.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="record-without-voice"
              onClick={() => {
                setAskMic(false);
                void startRecording();
              }}
            >
              Record without voice
            </Button>
            <Button
              disabled={micBusy}
              data-testid="record-with-mic"
              onClick={async () => {
                await useDevicesStore.getState().startMic();
                if (selectMicLive(useDevicesStore.getState())) {
                  setAskMic(false);
                  void startRecording();
                }
              }}
            >
              Turn on mic and record
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FinishedDialog />
    </div>
  );
}

function FinishedDialog() {
  const navigate = useNavigate();
  const finished = useRecordingStore((s) => s.finished);
  const set = useRecordingStore((s) => s.set);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setMissing(false);
    if (!finished) return setUrl(null);
    let cancelled = false;
    let made: string | null = null;
    void recordingBlob(finished).then((blob) => {
      if (cancelled) return;
      if (!blob) return setMissing(true);
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [finished]);

  const close = () => set({ finished: null });
  return (
    <Dialog open={!!finished} onOpenChange={(open) => !open && close()}>
      <DialogContent data-testid="recording-finished">
        <DialogHeader>
          <DialogTitle>Recording saved</DialogTitle>
          <DialogDescription>
            {finished && `${formatDuration(finished.durationMs)} · ${formatBytes(finished.bytes)} · .${finished.extension}`}. It stays in this browser until you delete it. Download it to keep a copy.
          </DialogDescription>
        </DialogHeader>
        {missing && (
          <p className="text-sm text-destructive" role="alert">
            The file can't be found.
          </p>
        )}
        {url && <video src={url} controls className="aspect-video w-full rounded-md bg-black" data-testid="recording-playback" />}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            data-testid="recording-delete"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete
          </Button>
          <Button
            variant="secondary"
            disabled={!url}
            data-testid="recording-edit"
            onClick={() => {
              if (!finished) return;
              close();
              navigate(`/recordings/${finished.id}/edit`);
            }}
          >
            <Scissors /> Edit
          </Button>
          <Button disabled={!url} data-testid="recording-download" onClick={() => finished && void downloadRecording(finished).then((ok) => setMissing(!ok))}>
            <Download /> Download
          </Button>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this recording?"
          description="Its file is removed from this browser. This can't be undone."
          confirmLabel="Delete"
          onConfirm={async () => {
            if (!finished) return;
            await deleteRecording(finished);
            close();
          }}
          testId="recording-delete-confirm"
        />
      </DialogContent>
    </Dialog>
  );
}

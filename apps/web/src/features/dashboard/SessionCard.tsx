import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { db, type SessionRecord } from "@/db/dexie";
import { formatRelative } from "@/lib/format";

interface Props {
  session: SessionRecord;
  onOpen: () => void;
  onRename: (title: string) => Promise<void> | void;
  onDuplicate: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export function SessionCard({ session, onOpen, onRename, onDuplicate, onDelete }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setTitle(session.title), [session.title]);

  const firstSlide = useLiveQuery(() => db().slides.get(`${session.id}:0`), [session.id]);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!firstSlide) {
      setThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(firstSlide.thumb);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstSlide]);

  const commitRename = async () => {
    setRenaming(false);
    if (title.trim() && title !== session.title) await onRename(title);
    else setTitle(session.title);
  };

  return (
    <div className="panel group relative overflow-hidden" data-testid="session-card">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={`Open ${session.title}`}>
        <div className="aspect-video w-full bg-black/40">
          {thumbUrl ? (
            <img src={thumbUrl} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{session.slideCount === 0 ? "No slides yet" : "…"}</div>
          )}
        </div>
      </button>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") {
                  setTitle(session.title);
                  setRenaming(false);
                }
              }}
              className="h-7 text-sm"
              data-testid="session-rename-input"
            />
          ) : (
            <button type="button" onClick={onOpen} className="block w-full truncate text-left text-sm font-medium" data-testid="session-title">
              {session.title}
            </button>
          )}
          <p className="truncate text-[11px] text-muted-foreground">
            {session.slideCount} slide{session.slideCount === 1 ? "" : "s"} · {formatRelative(session.updatedAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Session actions" data-testid="session-menu">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void onDuplicate()}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)} data-testid="session-delete">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{session.title}”?</DialogTitle>
            <DialogDescription>This removes the slides, script and speaker notes for this presentation from this device. Recordings are kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="session-delete-confirm"
              onClick={async () => {
                setConfirmDelete(false);
                await onDelete();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

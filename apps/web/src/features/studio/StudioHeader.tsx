import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRecordingStore } from "@/stores/private/recordingStore";
import { useSessionStore } from "@/stores/private/sessionStore";
import { renameSession } from "@/db/repositories/sessions";
import { BernouLogo } from "@/ui/logo";
import { Input } from "@/ui/input";
import { SafetyControls } from "@/features/safety/SafetyControls";

export function StudioHeader() {
  const session = useSessionStore((s) => s.session);
  const [title, setTitle] = useState("");
  useEffect(() => setTitle(session?.title ?? ""), [session?.title]);

  const commit = async () => {
    if (!session) return;
    const t = title.trim();
    if (t && t !== session.title) await renameSession(session.id, t);
    else setTitle(session.title);
  };

  const recording = useRecordingStore((s) => s.status !== "idle");

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/70 px-3">
      <Link
        to="/"
        data-testid="back-to-dashboard"
        className={cn("flex items-center gap-2 rounded px-1 py-1 text-muted-foreground hover:text-foreground", recording && "cursor-not-allowed opacity-50")}
        aria-label="Back to dashboard"
        aria-disabled={recording}
        title={recording ? "Stop the recording before leaving" : undefined}
        onClick={(e) => recording && e.preventDefault()}
      >
        <ChevronLeft className="h-4 w-4" />
        <BernouLogo className="h-5 w-5" />
      </Link>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-7 max-w-sm border-transparent bg-transparent px-2 text-sm font-medium hover:border-input focus-visible:border-input"
        aria-label="Presentation title (private)"
        data-testid="studio-title"
      />
      <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">Private workspace</span>
      <div className="ml-auto flex items-center gap-2" id="studio-header-right">
        <SafetyControls />
      </div>
    </header>
  );
}

/**
 * PRIVATE speaker notes, one note per slide, following the active slide.
 * Autosaves to IndexedDB. Never imported by audience code.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/ui/textarea";
import { useNotesStore } from "@/stores/private/notesStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { saveNote } from "@/db/repositories/notes";
import { selectSectionsForSlide, useScriptStore } from "@/stores/private/scriptStore";

export function NotesPanel() {
  const active = useDeckStore((s) => s.activeIndex);
  const slideCount = useDeckStore((s) => s.slides.length);
  const sessionId = useNotesStore((s) => s.sessionId);
  const body = useNotesStore((s) => s.bySlide[active] ?? "");
  const setNote = useNotesStore((s) => s.setNote);
  const sections = useScriptStore((s) => s.sections);
  const linked = useMemo(() => selectSectionsForSlide({ sections }, active), [sections, active]);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ sessionId: string; slide: number; body: string } | null>(null);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const edit = pending.current;
    pending.current = null;
    if (edit) await saveNote(edit.sessionId, edit.slide, edit.body);
  };

  const onChange = (v: string) => {
    if (!sessionId) return;
    // Typing has moved to another slide: the last slide's edit can't share the debounce.
    if (pending.current && pending.current.slide !== active) void flush();
    setNote(active, v);
    setSaved(false);
    pending.current = { sessionId, slide: active, body: v };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().then(() => setSaved(true)), 400);
  };

  useEffect(() => () => void flush(), []);

  return (
    <div className="flex h-full flex-col" data-testid="notes-panel">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">{slideCount === 0 ? "Notes (no slides yet)" : `Notes for slide ${active + 1} of ${slideCount}`}</span>
        <span className={saved ? "text-[10px] uppercase tracking-wider text-muted-foreground" : "text-[10px] uppercase tracking-wider text-primary"} data-testid="notes-save-state">
          {saved ? "Saved" : "Saving…"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <Textarea
          value={body}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Private notes for this slide — reminders, timings, questions to ask…"
          className="min-h-[180px] text-[13px] leading-relaxed"
          aria-label={`Speaker notes for slide ${active + 1}`}
          data-testid="notes-body"
          disabled={!sessionId}
        />
        {linked.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="panel-title px-1">Script linked to this slide</div>
            {linked.map((sec) => (
              <div key={sec.id} className="rounded-md border border-border/60 bg-panel-raised p-2 text-xs leading-relaxed text-muted-foreground" data-testid="notes-linked-section">
                {sec.title && <div className="mb-1 font-medium text-foreground">{sec.title}</div>}
                <div className="line-clamp-6 whitespace-pre-wrap">{sec.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

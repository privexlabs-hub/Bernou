/**
 * PRIVATE script editor. Sections are editable cards; each can be linked to a
 * slide. A "paste a whole speech" box is shown when the script is empty.
 * Autosaves to IndexedDB (debounced) and shows a saved/unsaved indicator.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Link2, Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { selectWordCount, useScriptStore } from "@/stores/private/scriptStore";
import { useDeckStore } from "@/stores/public/deckStore";
import { saveScript } from "@/db/repositories/scripts";
import { cn } from "@/lib/utils";

/** Debounced autosave + flush on unmount/pagehide. */
export function useScriptAutosave() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const flush = async () => {
      t = null;
      const s = useScriptStore.getState();
      if (!s.sessionId || !s.dirty) return;
      await saveScript(s.sessionId, s.sections);
      // An edit made during the save is still unsaved.
      if (useScriptStore.getState().sections === s.sections) useScriptStore.getState().markSaved();
    };
    const unsub = useScriptStore.subscribe((s, p) => {
      // The session is being swapped out: its pending edit can't wait for the debounce.
      if (p.dirty && p.sessionId && s.sessionId !== p.sessionId) {
        if (t) clearTimeout(t);
        t = null;
        void saveScript(p.sessionId, p.sections);
        return;
      }
      if (s.dirty && s.sections !== p.sections) {
        if (t) clearTimeout(t);
        t = setTimeout(() => void flush(), 500);
      }
    });
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      unsub();
      window.removeEventListener("pagehide", onHide);
      if (t) {
        clearTimeout(t);
        void flush();
      }
    };
  }, []);
}

export function ScriptEditor() {
  const sessionId = useScriptStore((s) => s.sessionId);
  const sections = useScriptStore((s) => s.sections);
  const activeId = useScriptStore((s) => s.activeSectionId);
  const dirty = useScriptStore((s) => s.dirty);
  const words = useScriptStore(selectWordCount);
  const slideCount = useDeckStore((s) => s.slides.length);
  const { addSection, updateSection, removeSection, moveSection, setActiveSection, replaceWithText, splitSection } = useScriptStore.getState();
  const [paste, setPaste] = useState("");

  if (sections.length === 0) {
    return (
      <div className="space-y-3 p-3" data-testid="script-empty">
        <p className="text-xs text-muted-foreground">Paste your whole speech here, or start with an empty section. The script is private and never leaves this device.</p>
        <Textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste your speech…"
          className="min-h-[220px] font-mono text-xs leading-relaxed"
          data-testid="script-paste"
          disabled={!sessionId}
          aria-label="Paste your speech"
        />
        <div className="flex gap-2">
          <Button
            disabled={!sessionId || !paste.trim()}
            onClick={() => {
              replaceWithText(paste.trim());
              setPaste("");
            }}
            data-testid="script-paste-commit"
          >
            Use this speech
          </Button>
          <Button variant="outline" disabled={!sessionId} onClick={() => addSection()} data-testid="script-add-first">
            <Plus /> Empty section
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="script-editor">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {sections.length} section{sections.length === 1 ? "" : "s"} · {words} words
        </span>
        <span className={cn("text-[10px] uppercase tracking-wider", dirty ? "text-primary" : "text-muted-foreground")} data-testid="script-save-state">
          {dirty ? "Saving…" : "Saved"}
        </span>
      </div>
      <p className="border-b border-border/70 px-3 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="script-links-help">
        Linking a section to a slide is optional. Every section shows in the prompter, in this order, linked or not.
      </p>
      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {sections.map((sec, i) => (
          <li key={sec.id}>
            <SectionCard
              index={i}
              total={sections.length}
              active={sec.id === activeId}
              section={sec}
              slideCount={slideCount}
              onFocus={() => setActiveSection(sec.id)}
              onChange={(patch) => updateSection(sec.id, patch)}
              onRemove={() => removeSection(sec.id)}
              onMove={(d) => moveSection(sec.id, d)}
              onAddAfter={() => addSection(sec.id)}
              onSplit={() => splitSection(sec.id)}
            />
          </li>
        ))}
      </ol>
      <div className="border-t border-border/70 p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={() => addSection()} data-testid="script-add-section">
          <Plus /> Add section
        </Button>
      </div>
    </div>
  );
}

function SectionCard({
  index,
  total,
  active,
  section,
  slideCount,
  onFocus,
  onChange,
  onRemove,
  onMove,
  onAddAfter,
  onSplit,
}: {
  index: number;
  total: number;
  active: boolean;
  section: { id: string; title: string; body: string; slideIndex: number | null };
  slideCount: number;
  onFocus: () => void;
  onChange: (p: Partial<{ title: string; body: string; slideIndex: number | null }>) => void;
  onRemove: () => void;
  onMove: (d: -1 | 1) => void;
  onAddAfter: () => void;
  onSplit: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  // auto-grow
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(600, el.scrollHeight)}px`;
  }, [section.body]);
  const canSplit = /\n\s*\n/.test(section.body);

  return (
    <div className={cn("rounded-md border bg-panel-raised p-2 transition-colors", active ? "border-primary/60" : "border-border/60")} data-testid="script-section" onFocusCapture={onFocus}>
      <div className="mb-1.5 flex items-center gap-1">
        <span className="w-5 font-mono text-[10px] text-muted-foreground">{index + 1}</span>
        <Input value={section.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Section title (optional)" className="h-7 flex-1 text-xs" aria-label="Section title" data-testid="section-title" />
        <Select value={section.slideIndex === null ? "none" : String(section.slideIndex)} onValueChange={(v) => onChange({ slideIndex: v === "none" ? null : Number(v) })}>
          <SelectTrigger
            className="h-7 w-[116px] shrink-0"
            aria-label="Linked slide"
            title="Optional. A linked section is listed under that slide in Notes, and with Follow slides on, the prompter jumps to it when you reach that slide."
            data-testid="section-slide"
          >
            <Link2 className="mr-1 h-3 w-3 shrink-0 opacity-60" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No slide</SelectItem>
            {Array.from({ length: slideCount }, (_, i) => (
              <SelectItem key={i} value={String(i)}>
                Slide {i + 1}
              </SelectItem>
            ))}
            {section.slideIndex !== null && section.slideIndex >= slideCount && <SelectItem value={String(section.slideIndex)}>Slide {section.slideIndex + 1} (not in this deck)</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        ref={ta}
        value={section.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder="Section text…"
        className="min-h-[72px] resize-none text-[13px] leading-relaxed"
        aria-label={`Section ${index + 1} text`}
        data-testid="section-body"
      />
      <div className="mt-1 flex items-center gap-0.5">
        <IconBtn label="Move up" onClick={() => onMove(-1)} disabled={index === 0} testId="section-up">
          <ArrowUp />
        </IconBtn>
        <IconBtn label="Move down" onClick={() => onMove(1)} disabled={index === total - 1} testId="section-down">
          <ArrowDown />
        </IconBtn>
        <IconBtn label="Split at blank lines" onClick={onSplit} disabled={!canSplit} testId="section-split">
          <Scissors />
        </IconBtn>
        <IconBtn label="Add section after" onClick={onAddAfter} testId="section-add-after">
          <Plus />
        </IconBtn>
        <span className="flex-1" />
        <IconBtn label="Delete section" onClick={onRemove} testId="section-delete" destructive>
          <Trash2 />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, testId, destructive, children }: { label: string; onClick: () => void; disabled?: boolean; testId: string; destructive?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("h-7 w-7 [&_svg]:size-3.5", destructive && "hover:text-destructive")} onClick={onClick} disabled={disabled} aria-label={label} data-testid={testId}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

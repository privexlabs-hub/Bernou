/** The editor page's side of the export Worker. */
import { useEffect, useState } from "react";
import type { EditProject } from "@/db/dexie";
import type { ExportAudio, ExportResult, FromWorker, OutputDir, SourceInfo, ToWorker } from "./protocol";

type Pending = { resolve: (m: FromWorker) => void; reject: (e: Error) => void; onProgress?: ((done: number, total: number) => void) | undefined };

export class EditorWorker {
  private worker = new Worker(new URL("./exportWorker.ts", import.meta.url), { type: "module" });
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") return p.onProgress?.(m.done, m.total);
      this.pending.delete(m.id);
      if (m.type === "error") p.reject(new Error(m.message));
      else p.resolve(m);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "The export stopped unexpectedly."));
      this.pending.clear();
    };
  }

  private call(m: Omit<ToWorker, "id"> & { type: Exclude<ToWorker["type"], "cancel"> }, onProgress?: Pending["onProgress"], transfer: Transferable[] = []): Promise<FromWorker> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...m, id }, transfer);
    });
  }

  async probe(file: Blob): Promise<SourceInfo> {
    const m = await this.call({ type: "probe", file } as never);
    return (m as Extract<FromWorker, { type: "probe" }>).info;
  }

  async decodeAudio(file: Blob, peaksPerSecond: number) {
    const m = (await this.call({ type: "decodeAudio", file, peaksPerSecond } as never)) as Extract<FromWorker, { type: "decodeAudio" }>;
    return { samples: m.samples, sampleRate: m.sampleRate, peaks: m.peaks };
  }

  async export(opts: { file: Blob; project: EditProject; fileName: string; dir: OutputDir; audioOnly: boolean; range?: { from: number; to: number }; audio: ExportAudio }, onProgress?: Pending["onProgress"]): Promise<ExportResult> {
    // Track samples are copies made for this export: hand them over rather than copy again.
    const transfer = opts.audio.tracks.flatMap((t) => t.planes.map((p) => p.buffer));
    const m = (await this.call({ type: "export", ...opts } as never, onProgress, transfer)) as Extract<FromWorker, { type: "export" }>;
    return m.result;
  }

  cancel() {
    this.worker.postMessage({ type: "cancel" } satisfies ToWorker);
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new WorkerClosed());
    this.pending.clear();
  }
}

/** A request that never finished because the page closed its worker: not a failure to report. */
export class WorkerClosed extends Error {
  constructor() {
    super("closed");
  }
}

/**
 * One worker for the time the editor is open, made and ended by the same effect.
 * (Made once outside it, StrictMode's practice unmount in development ended the
 * worker the page went on to use, and the editor never finished opening.)
 */
export function useEditorWorker(): EditorWorker | null {
  const [worker, setWorker] = useState<EditorWorker | null>(null);
  useEffect(() => {
    const w = new EditorWorker();
    setWorker(w);
    return () => {
      w.dispose();
      setWorker((current) => (current === w ? null : current));
    };
  }, []);
  return worker;
}

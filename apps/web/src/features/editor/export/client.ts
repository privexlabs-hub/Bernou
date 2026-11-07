/** The editor page's side of the export Worker. */
import type { EditProject } from "@/db/dexie";
import type { ExportResult, FromWorker, OutputDir, SourceInfo, ToWorker } from "./protocol";

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

  private call(m: Omit<ToWorker, "id"> & { type: Exclude<ToWorker["type"], "cancel"> }, onProgress?: Pending["onProgress"]): Promise<FromWorker> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...m, id });
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

  async export(opts: { file: Blob; project: EditProject; fileName: string; dir: OutputDir; audioOnly: boolean; range?: { from: number; to: number } }, onProgress?: Pending["onProgress"]): Promise<ExportResult> {
    const m = (await this.call({ type: "export", ...opts } as never, onProgress)) as Extract<FromWorker, { type: "export" }>;
    return m.result;
  }

  cancel() {
    this.worker.postMessage({ type: "cancel" } satisfies ToWorker);
  }

  dispose() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("closed"));
    this.pending.clear();
  }
}

/**
 * Where recordings live while being written. OPFS through a sync access handle
 * flushes every chunk, so a crash loses only what the recorder hadn't yet handed
 * over (see KEYFRAME_MS). Blob workers follow the composition engine's scheduler:
 * no bundler involvement.
 */
export interface RecordingSink {
  /** Queued in order; rejects if the write failed. */
  write(chunk: Blob): Promise<void>;
  /** Waits for queued writes and returns the final size. */
  close(): Promise<number>;
  bytes(): number;
  readonly kind: "opfs" | "memory";
}

const DIR = "recordings";

const WRITER_SRC = `
let handle = null, at = 0;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "open") {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(m.dir, { create: true });
      const file = await dir.getFileHandle(m.name, { create: true });
      handle = await file.createSyncAccessHandle();
    } else if (m.type === "write") {
      const data = new Uint8Array(m.buffer);
      const written = handle.write(data, { at });
      at += written;
      if (written !== data.length) throw new DOMException("short write", "QuotaExceededError");
      handle.flush();
    } else if (m.type === "close") {
      handle.flush();
      handle.close();
      handle = null;
    }
    self.postMessage({ id: m.id, bytes: at });
  } catch (e) {
    self.postMessage({ id: m.id, error: e.name + ": " + e.message });
  }
};`;

export async function openOpfsSink(name: string): Promise<RecordingSink> {
  // Sync access handles exist only inside workers, so the only way to find out
  // whether they work is for the worker to try: a failed open rejects below.
  const worker = new Worker(URL.createObjectURL(new Blob([WRITER_SRC], { type: "text/javascript" })));
  let nextId = 0;
  const waiting = new Map<number, { resolve: (bytes: number) => void; reject: (e: Error) => void }>();
  worker.onmessage = ({ data }: MessageEvent<{ id: number; bytes?: number; error?: string }>) => {
    const w = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) w?.reject(new Error(data.error));
    else w?.resolve(data.bytes ?? 0);
  };
  const call = (message: object, transfer: Transferable[] = []) =>
    new Promise<number>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });

  try {
    await call({ type: "open", dir: DIR, name });
  } catch (e) {
    worker.terminate();
    throw e;
  }

  let bytes = 0;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    kind: "opfs",
    bytes: () => bytes,
    write(chunk) {
      const job = queue.then(async () => {
        const buffer = await chunk.arrayBuffer();
        bytes = await call({ type: "write", buffer }, [buffer]);
      });
      queue = job;
      return job;
    },
    async close() {
      try {
        await queue.catch(() => undefined);
        bytes = await call({ type: "close" });
        return bytes;
      } finally {
        worker.terminate();
      }
    },
  };
}

/** Fallback without OPFS: lost on reload, and capped because it's all in RAM. */
const memoryFiles = new Map<string, Blob>();

export function createMemorySink(name: string, capBytes: number): RecordingSink {
  const chunks: Blob[] = [];
  let bytes = 0;
  return {
    kind: "memory",
    bytes: () => bytes,
    async write(chunk) {
      if (bytes + chunk.size > capBytes) throw new DOMException("memory recording limit reached", "QuotaExceededError");
      chunks.push(chunk);
      bytes += chunk.size;
      memoryFiles.set(name, new Blob(chunks));
    },
    close: async () => bytes,
  };
}

async function directory(create = false): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });
  } catch {
    return null;
  }
}

export async function readRecordingFile(name: string): Promise<Blob | null> {
  const memory = memoryFiles.get(name);
  if (memory) return memory;
  try {
    return await (await (await directory())?.getFileHandle(name))?.getFile() ?? null;
  } catch {
    return null;
  }
}

/** No file is not an error: the goal is that it's gone. */
export async function deleteRecordingFile(name: string): Promise<void> {
  memoryFiles.delete(name);
  try {
    await (await directory())?.removeEntry(name);
  } catch (e) {
    if ((e as Error).name !== "NotFoundError") throw e;
  }
}

export async function listRecordingFiles(): Promise<string[]> {
  const dir = await directory();
  if (!dir) return [];
  const names: string[] = [];
  for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
  return names;
}

export async function eraseRecordingFiles(): Promise<void> {
  memoryFiles.clear();
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return;
  try {
    await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true });
  } catch (e) {
    if ((e as Error).name !== "NotFoundError") throw e;
  }
}

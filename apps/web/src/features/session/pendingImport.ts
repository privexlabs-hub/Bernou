/**
 * In-memory hand-off of a File from the dashboard to the studio. The file is
 * never serialised or stored; it lives only until the studio consumes it.
 */
const pending = new Map<string, File[]>();

export function stashPendingImport(sessionId: string, files: File[]) {
  pending.set(sessionId, files);
}

export function takePendingImport(sessionId: string): File[] | undefined {
  const f = pending.get(sessionId);
  pending.delete(sessionId);
  return f;
}

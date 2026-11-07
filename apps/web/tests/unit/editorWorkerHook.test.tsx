import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/** A Worker stand-in that records whether it was terminated. */
const made: { terminated: boolean }[] = [];
class FakeWorker {
  terminated = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    made.push(this);
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
}
vi.stubGlobal("Worker", FakeWorker);

import { useEditorWorker } from "@/features/editor/export/client";

afterEach(() => void (made.length = 0));

describe("the editor's worker under StrictMode", () => {
  // Regression: StrictMode's practice unmount terminated the one worker the page then kept using,
  // so in development the editor never got past "Opening the recording…".
  it("the worker the page ends up with is alive", async () => {
    const { result } = renderHook(() => useEditorWorker(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current).not.toBeNull());
    const live = made.filter((w) => !w.terminated);
    expect(live).toHaveLength(1);
    expect((result.current as unknown as { worker: FakeWorker }).worker.terminated).toBe(false);
  });

  it("leaving the page terminates it", async () => {
    const { result, unmount } = renderHook(() => useEditorWorker(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current).not.toBeNull());
    unmount();
    expect(made.every((w) => w.terminated)).toBe(true);
  });
});

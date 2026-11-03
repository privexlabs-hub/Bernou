import { beforeEach, describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => ({ camera: [] as ((s: MediaStream) => void)[], mic: [] as ((s: MediaStream) => void)[], graphs: [] as { close: ReturnType<typeof vi.fn> }[] }));

vi.mock("@bernou/media-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bernou/media-core")>()),
  listDevices: async () => [],
  queryPermission: async () => "granted",
  onDeviceChange: () => () => undefined,
  openCamera: () => new Promise((r) => pending.camera.push(r)),
  openMicrophone: () => new Promise((r) => pending.mic.push(r)),
  createAudioGraph: () => {
    const g = { resume: async () => undefined, setSource: vi.fn(), setMuted: vi.fn(), close: vi.fn(async () => undefined), outputStream: null, level: () => 0 };
    pending.graphs.push(g);
    return g;
  },
}));

import { useDevicesStore } from "@/stores/private/devicesStore";

function fakeStream(kind: "video" | "audio") {
  const track = { kind, readyState: "live", stop: vi.fn(() => void (track.readyState = "ended")), addEventListener: vi.fn(), getSettings: () => ({ deviceId: "d1" }) };
  return { getTracks: () => [track], getVideoTracks: () => (kind === "video" ? [track] : []), getAudioTracks: () => (kind === "audio" ? [track] : []), track } as unknown as MediaStream & { track: typeof track };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("devicesStore cancellation", () => {
  beforeEach(async () => {
    await useDevicesStore.getState().releaseAll();
    pending.camera.length = 0;
    pending.mic.length = 0;
  });

  it("releaseAll cancels an in-flight camera start: the late stream is stopped and never stored", async () => {
    void useDevicesStore.getState().startCamera();
    const report = await useDevicesStore.getState().releaseAll();
    expect(report).toEqual({ tracksStopped: 0, requestsCancelled: 1 });

    const late = fakeStream("video");
    pending.camera[0]!(late);
    await flush();
    expect(late.track.stop).toHaveBeenCalled();
    expect(useDevicesStore.getState().cameraStream).toBeNull();
    expect(useDevicesStore.getState().cameraBusy).toBe(false);
  });

  it("releaseAll cancels an in-flight mic start", async () => {
    void useDevicesStore.getState().startMic();
    expect((await useDevicesStore.getState().releaseAll()).requestsCancelled).toBe(1);

    const late = fakeStream("audio");
    pending.mic[0]!(late);
    await flush();
    expect(late.track.stop).toHaveBeenCalled();
    expect(useDevicesStore.getState().micStream).toBeNull();
    expect(useDevicesStore.getState().audioGraph).toBeNull();
  });

  it("releaseAll reports live tracks it stopped and clears state before the graph finishes closing", async () => {
    const start = useDevicesStore.getState().startMic();
    const stream = fakeStream("audio");
    pending.mic[0]!(stream);
    await start;
    expect(useDevicesStore.getState().micStream).toBe(stream);

    const release = useDevicesStore.getState().releaseAll();
    expect(stream.track.stop).toHaveBeenCalled(); // synchronous: not after an await
    expect(useDevicesStore.getState().micStream).toBeNull();
    expect((await release).tracksStopped).toBe(1);
  });

  it("a start after a cancelled one works, and the cancelled result cannot overwrite it", async () => {
    void useDevicesStore.getState().startCamera();
    await useDevicesStore.getState().releaseAll();
    const second = useDevicesStore.getState().startCamera();

    const good = fakeStream("video");
    const late = fakeStream("video");
    pending.camera[1]!(good);
    await second;
    pending.camera[0]!(late);
    await flush();

    expect(useDevicesStore.getState().cameraStream).toBe(good);
    expect(good.track.stop).not.toHaveBeenCalled();
    expect(late.track.stop).toHaveBeenCalled();
  });
});

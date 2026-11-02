import { describe, expect, it } from "vitest";
import { mapMediaError, streamIsLive, stopStream } from "../src/devices";

const err = (name: string) => Object.assign(new Error("x"), { name });

describe("mapMediaError", () => {
  it("maps permission denial", () => expect(mapMediaError(err("NotAllowedError"), "camera").code).toBe("denied"));
  it("maps missing device", () => expect(mapMediaError(err("NotFoundError"), "microphone").code).toBe("not-found"));
  it("maps device busy (common on Windows)", () => expect(mapMediaError(err("NotReadableError"), "camera").code).toBe("in-use"));
  it("maps overconstrained", () => expect(mapMediaError(err("OverconstrainedError"), "camera").code).toBe("overconstrained"));
  it("falls back to unknown with the raw message", () => {
    const m = mapMediaError(Object.assign(new Error("weird"), { name: "Whatever" }), "camera");
    expect(m.code).toBe("unknown");
    expect(m.message).toContain("weird");
  });
  it("messages name the device kind and an action", () => {
    expect(mapMediaError(err("NotAllowedError"), "microphone").message).toMatch(/Microphone.*permissions/);
  });
});

describe("stream helpers", () => {
  const fakeTrack = (state: "live" | "ended") => ({ readyState: state, stop() { this.readyState = "ended"; } });
  const fakeStream = (tracks: ReturnType<typeof fakeTrack>[]) => ({ getTracks: () => tracks }) as unknown as MediaStream;

  it("streamIsLive is true only with a live track", () => {
    expect(streamIsLive(fakeStream([fakeTrack("ended")]))).toBe(false);
    expect(streamIsLive(fakeStream([fakeTrack("live")]))).toBe(true);
    expect(streamIsLive(null)).toBe(false);
  });
  it("stopStream ends every track and is idempotent", () => {
    const s = fakeStream([fakeTrack("live"), fakeTrack("live")]);
    stopStream(s);
    stopStream(s);
    expect(streamIsLive(s)).toBe(false);
  });
});

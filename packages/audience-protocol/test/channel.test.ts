/**
 * AudienceChannel validation tests. Runs in jsdom? No — BroadcastChannel is
 * native in Node 18+, so these run in the default node environment.
 */
import { describe, expect, it, vi } from "vitest";
import { AudienceChannel } from "../src/channel";
import { blankPayload } from "../src/build";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("AudienceChannel", () => {
  it("delivers a valid payload from presenter to audience", async () => {
    const name = `t-${Math.random()}`;
    const presenter = new AudienceChannel("presenter", { name });
    const audience = new AudienceChannel("audience", { name });
    const got = vi.fn();
    audience.onMessage(got);
    presenter.send({ type: "payload", payload: blankPayload(1) });
    await wait(20);
    expect(got).toHaveBeenCalledTimes(1);
    expect(got.mock.calls[0]?.[0]?.type).toBe("payload");
    presenter.close();
    audience.close();
  });

  it("refuses to send a message with smuggled private fields", () => {
    const presenter = new AudienceChannel("presenter", { name: `t-${Math.random()}` });
    const bad = { type: "payload", payload: { ...blankPayload(1), notes: "CANARY-NOTES" } } as never;
    expect(() => presenter.send(bad)).toThrow(/refusing to send/);
    presenter.close();
  });

  it("drops inbound messages that do not match the schema", async () => {
    const name = `t-${Math.random()}`;
    const raw = new BroadcastChannel(name);
    const audience = new AudienceChannel("audience", { name });
    const got = vi.fn();
    audience.onMessage(got);
    raw.postMessage({ type: "payload", payload: { v: 1, seq: 1, script: "CANARY" } });
    raw.postMessage("garbage");
    await wait(20);
    expect(got).not.toHaveBeenCalled();
    expect(audience.invalidCount).toBe(2);
    raw.close();
    audience.close();
  });

  it("presenter role cannot send audience-only envelopes", () => {
    const presenter = new AudienceChannel("presenter", { name: `t-${Math.random()}` });
    expect(() => presenter.send({ type: "hello", from: "audience" } as never)).toThrow();
    presenter.close();
  });
});

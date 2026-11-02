/**
 * Validated BroadcastChannel wrapper.
 *
 * - Same-origin only (a property of BroadcastChannel itself).
 * - Every outbound message is validated before posting; an invalid message
 *   throws in the sender rather than leaking anything.
 * - Every inbound message is validated before any handler sees it; invalid
 *   messages are dropped and counted.
 * - Privacy test P2 injects a spy here to deep-scan every frame for canaries.
 */
import { z } from "zod";
import {
  AudienceToPresenterSchema,
  CHANNEL_NAME,
  PresenterToAudienceSchema,
  type AudienceToPresenter,
  type PresenterToAudience,
} from "./messages";

export type ChannelRole = "presenter" | "audience";

type OutboundOf<R extends ChannelRole> = R extends "presenter" ? PresenterToAudience : AudienceToPresenter;
type InboundOf<R extends ChannelRole> = R extends "presenter" ? AudienceToPresenter : PresenterToAudience;

export interface AudienceChannelOptions {
  /** Override the channel name (tests). */
  name?: string;
  /** Called with every outbound message after validation. Used by privacy tests. */
  onSend?: (message: unknown) => void;
  /** Called with every inbound message that failed validation. */
  onInvalid?: (raw: unknown, error: string) => void;
}

export class AudienceChannel<R extends ChannelRole> {
  private readonly bc: BroadcastChannel;
  private readonly outSchema: z.ZodTypeAny;
  private readonly inSchema: z.ZodTypeAny;
  private readonly handlers = new Set<(m: InboundOf<R>) => void>();
  private closed = false;
  public invalidCount = 0;

  constructor(
    public readonly role: R,
    private readonly opts: AudienceChannelOptions = {},
  ) {
    this.bc = new BroadcastChannel(opts.name ?? CHANNEL_NAME);
    this.outSchema = role === "presenter" ? PresenterToAudienceSchema : AudienceToPresenterSchema;
    this.inSchema = role === "presenter" ? AudienceToPresenterSchema : PresenterToAudienceSchema;
    this.bc.onmessage = (ev: MessageEvent) => this.receive(ev.data);
  }

  send(message: OutboundOf<R>): void {
    if (this.closed) return;
    const r = this.outSchema.safeParse(message);
    if (!r.success) {
      // Refuse to send anything that is not exactly an allowed envelope.
      throw new Error(`AudienceChannel(${this.role}): refusing to send invalid message: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    this.opts.onSend?.(r.data);
    this.bc.postMessage(r.data);
  }

  onMessage(handler: (m: InboundOf<R>) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private receive(raw: unknown): void {
    const r = this.inSchema.safeParse(raw);
    if (!r.success) {
      this.invalidCount++;
      this.opts.onInvalid?.(raw, r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    for (const h of this.handlers) h(r.data as InboundOf<R>);
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
    this.bc.close();
  }
}

export function isBroadcastChannelSupported(): boolean {
  return typeof BroadcastChannel !== "undefined";
}

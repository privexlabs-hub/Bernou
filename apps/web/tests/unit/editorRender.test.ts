import { describe, expect, it } from "vitest";
import { drawFrame, drawOverlays, pictureFilter, textLayout } from "@/features/editor/render";
import { wavBytes } from "@/features/editor/wav";
import type { Overlay } from "@/db/dexie";

/** A canvas context that records what's drawn. Text is 0.5 em per character. */
function fakeCtx() {
  const calls: { op: string; args: unknown[]; alpha: number; fill: unknown; stroke: unknown; filter: string; font: string }[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, filter: "none", font: "10px sans-serif", textBaseline: "alphabetic", lineJoin: "miter" };
  const rec = (op: string) => (...args: unknown[]) => calls.push({ op, args, alpha: ctx.globalAlpha as number, fill: ctx.fillStyle, stroke: ctx.strokeStyle, filter: ctx.filter as string, font: ctx.font as string });
  for (const op of ["fillRect", "strokeRect", "fillText", "drawImage", "beginPath", "roundRect", "fill", "stroke"]) ctx[op] = rec(op);
  const stack: Record<string, unknown>[] = [];
  ctx.save = () => stack.push({ ...ctx });
  ctx.restore = () => Object.assign(ctx, stack.pop());
  ctx.measureText = (s: string) => ({ width: s.length * 0.5 * parseFloat(String(ctx.font).match(/(\d+(?:\.\d+)?)px/)![1]!) });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const text = (o: Partial<Overlay> = {}): Overlay => ({ id: "t", kind: "text", start: 2, end: 4, x: 0.1, y: 0.1, w: 0.5, h: 0.2, color: "#ffffff", text: "Hello world", size: "m", box: true, ...o }) as Overlay;
const box = (o: Partial<Overlay> = {}): Overlay => ({ id: "h", kind: "highlight", start: 0, end: 10, x: 0.5, y: 0.5, w: 0.25, h: 0.25, color: "#f59e0b", style: "outline", ...o }) as Overlay;

describe("picture filter", () => {
  it("neutral is no filter at all", () => {
    expect(pictureFilter({ brightness: 0, contrast: 0, saturation: 0 })).toBe("none");
  });
  it("maps -50..50 to a factor of 1 + x/100, the same string for CSS and canvas", () => {
    expect(pictureFilter({ brightness: 30, contrast: -20, saturation: 50 })).toBe("brightness(1.3) contrast(0.8) saturate(1.5)");
  });
  it("clamps out-of-range values", () => {
    expect(pictureFilter({ brightness: 500, contrast: -500, saturation: 0 })).toBe("brightness(1.5) contrast(0.5) saturate(1)");
  });
});

describe("overlays", () => {
  it("only while active: from start, up to but not including end", () => {
    for (const [t, n] of [[1.99, 0], [2, 1], [3.99, 1], [4, 0]] as const) {
      const { ctx, calls } = fakeCtx();
      drawOverlays(ctx, [text()], t, 1000, 500);
      expect(calls.filter((c) => c.op === "fillText").length > 0 ? 1 : 0).toBe(n);
    }
  });

  it("an outline highlight is drawn in its colour at its place", () => {
    const { ctx, calls } = fakeCtx();
    drawOverlays(ctx, [box()], 5, 1000, 500);
    const s = calls.find((c) => c.op === "strokeRect")!;
    expect(s.args).toEqual([500, 250, 250, 125]);
    expect(s.stroke).toBe("#f59e0b");
  });

  it("a fill highlight is see-through", () => {
    const { ctx, calls } = fakeCtx();
    drawOverlays(ctx, [box({ style: "fill" } as Partial<Overlay>)], 5, 1000, 500);
    const f = calls.find((c) => c.op === "fillRect")!;
    expect(f.args).toEqual([500, 250, 250, 125]);
    expect(f.alpha).toBeGreaterThan(0.1);
    expect(f.alpha).toBeLessThan(0.5);
  });

  it("text wraps to the overlay's width, with its backing box drawn first", () => {
    const long = "one two three four five six seven eight nine ten";
    const lines = textLayout(long, 500, 25); // 0.5 em per char at 25 px: about 40 chars a line
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length * 0.5 * 25).toBeLessThanOrEqual(500);
    const { ctx, calls } = fakeCtx();
    drawOverlays(ctx, [text({ text: long } as Partial<Overlay>)], 3, 1000, 500);
    const firstText = calls.findIndex((c) => c.op === "fillText");
    const boxAt = calls.findIndex((c) => c.op === "fill" || c.op === "fillRect");
    expect(boxAt).toBeGreaterThanOrEqual(0);
    expect(boxAt).toBeLessThan(firstText);
    expect(calls.filter((c) => c.op === "fillText").length).toBe(textLayout(long, 500 - 2 * 0.4 * 25, 25).length);
  });

  it("a word longer than the width is broken, not lost", () => {
    const lines = textLayout("abcdefghijklmnopqrstuvwxyz", 50, 10); // 10 chars a line
    expect(lines.join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(10);
  });

  it("text size follows S/M/L, relative to the frame height", () => {
    const sizes = (["s", "m", "l"] as const).map((size) => {
      const { ctx, calls } = fakeCtx();
      drawOverlays(ctx, [text({ size } as Partial<Overlay>)], 3, 1000, 500);
      return parseFloat(calls.find((c) => c.op === "fillText")!.font.match(/(\d+(?:\.\d+)?)px/)![1]!);
    });
    expect(sizes[0]).toBeLessThan(sizes[1]!);
    expect(sizes[1]).toBeLessThan(sizes[2]!);
  });
});

describe("frames", () => {
  const img = (name: string) => ({ name }) as unknown as CanvasImageSource;

  it("one source: drawn with the picture filter, overlays on top without it", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, [{ image: img("a"), weight: 1, t: 3 }], 1000, 500, { brightness: 20, contrast: 0, saturation: 0 }, [text()]);
    const d = calls.find((c) => c.op === "drawImage")!;
    expect(d.filter).toBe("brightness(1.2) contrast(1) saturate(1)");
    expect(calls.find((c) => c.op === "fillText")!.filter).toBe("none");
  });

  it("a smooth join draws the later side over the earlier one at its weight", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, [{ image: img("a"), weight: 0.7, t: 1.8 }, { image: img("b"), weight: 0.3, t: 4.2 }], 1000, 500, { brightness: 0, contrast: 0, saturation: 0 }, []);
    const d = calls.filter((c) => c.op === "drawImage");
    expect(d.map((c) => (c.args[0] as { name: string }).name)).toEqual(["a", "b"]);
    expect(d[0]!.alpha).toBe(1);
    expect(d[1]!.alpha).toBeCloseTo(0.3, 9);
  });

  it("in a join, each side's overlays fade with it", () => {
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, [{ image: img("a"), weight: 0.6, t: 3 }, { image: img("b"), weight: 0.4, t: 8 }], 1000, 500, { brightness: 0, contrast: 0, saturation: 0 }, [text()]);
    expect(calls.find((c) => c.op === "fillText")!.alpha).toBeCloseTo(0.6, 9); // active at 3, not at 8
  });
});

describe("WAV", () => {
  it("writes a 16-bit PCM file, channels interleaved, byte for byte", () => {
    const bytes = wavBytes([new Float32Array([0, 1, -1]), new Float32Array([0.5, -0.5, 0])], 48000);
    const d = new DataView(bytes.buffer);
    const str = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
    expect(str(0)).toBe("RIFF");
    expect(d.getUint32(4, true)).toBe(36 + 12);
    expect(str(8)).toBe("WAVE");
    expect(str(12)).toBe("fmt ");
    expect(d.getUint16(20, true)).toBe(1); // PCM
    expect(d.getUint16(22, true)).toBe(2);
    expect(d.getUint32(24, true)).toBe(48000);
    expect(d.getUint32(28, true)).toBe(48000 * 4);
    expect(d.getUint16(32, true)).toBe(4);
    expect(d.getUint16(34, true)).toBe(16);
    expect(str(36)).toBe("data");
    expect(d.getUint32(40, true)).toBe(12);
    expect([0, 1, 2, 3, 4, 5].map((i) => d.getInt16(44 + i * 2, true))).toEqual([0, 16384, 32767, -16384, -32768, 0]);
  });
});

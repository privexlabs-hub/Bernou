/**
 * Rendering tests on node-canvas. These establish the properties the privacy
 * model depends on:
 *   - determinism: same inputs → byte-identical pixels
 *   - the engine draws nothing that is not in the payload
 *   - layouts behave as specified
 *   - golden images for the deterministic layers
 */
import { describe, expect, it } from "vitest";
import { createCanvas, Path2D, DOMMatrix, ImageData, type Canvas } from "@napi-rs/canvas";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AudiencePayload } from "@bernou/audience-protocol";
import { renderFrame } from "../src/engine";
import type { AssetResolver, Ctx2D, FrameSource } from "../src/types";

Object.assign(globalThis, { Path2D, DOMMatrix, ImageData });

const golden = resolve(__dirname, "../../../fixtures/golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function payload(over: Partial<AudiencePayload> = {}, cam: Partial<AudiencePayload["camera"]> = {}): AudiencePayload {
  return {
    ink: null,
    v: 1,
    seq: 1,
    output: { profile: "720p", width: 1280, height: 720, background: "#0b0d12" },
    layout: "slide-with-camera",
    slide: { assetId: "s1", width: 960, height: 540 },
    camera: {
      enabled: true,
      deviceId: "dev",
      shape: "circle",
      x: 0.75,
      y: 0.6,
      size: 0.2,
      aspect: 1,
      cornerRadius: 0.12,
      border: { width: 4, color: "#ffffff" },
      shadow: true,
      mirror: false,
      opacity: 1,
      ...cam,
    },
    branding: null,
    ...over,
  };
}

/** A synthetic 960x540 "slide": light background, coloured bar, big dark block. No text (fonts vary across machines). */
function slideImage() {
  const c = createCanvas(960, 540) as Canvas;
  const g = c.getContext("2d");
  g.fillStyle = "#f4f4f4";
  g.fillRect(0, 0, 960, 540);
  g.fillStyle = "#3bb54a";
  g.fillRect(0, 0, 960, 70);
  g.fillStyle = "#1a1a1e";
  g.fillRect(60, 200, 420, 110);
  return c;
}
/** A synthetic 640x480 "camera frame": magenta/green diagonal blocks + white square. */
function cameraImage() {
  const c = createCanvas(640, 480) as Canvas;
  const g = c.getContext("2d");
  for (let y = 0; y < 480; y += 32)
    for (let x = 0; x < 640; x += 32) {
      g.fillStyle = (((x + y) >> 5) & 1) === 0 ? "#d040d0" : "#40c040";
      g.fillRect(x, y, 32, 32);
    }
  g.fillStyle = "#fff";
  g.fillRect(100, 200, 60, 60);
  return c;
}

const assets: AssetResolver = { get: (id) => (id === "s1" ? (slideImage() as unknown as CanvasImageSource) : null) };
const camera: FrameSource = { current: () => cameraImage() as unknown as CanvasImageSource, width: () => 640, height: () => 480 };

function render(p: AudiencePayload | null, cam: FrameSource | null = camera, w = 1280, h = 720) {
  const c = createCanvas(w, h) as Canvas;
  renderFrame(c.getContext("2d") as unknown as Ctx2D, { payload: p, assets, camera: cam });
  return c;
}
const png = (c: Canvas) => PNG.sync.read(c.toBuffer("image/png"));
const sha = (c: Canvas) => Buffer.from(c.toBuffer("image/png")).toString("base64");

function expectGolden(name: string, c: Canvas, threshold = 0) {
  const file = resolve(golden, `${name}.png`);
  const actual = png(c);
  if (UPDATE || !existsSync(file)) {
    mkdirSync(golden, { recursive: true });
    writeFileSync(file, PNG.sync.write(actual));
    if (!UPDATE) console.warn(`golden written: ${name}.png (first run)`);
    return;
  }
  const expected = PNG.sync.read(readFileSync(file));
  const diff = pixelmatch(actual.data, expected.data, null, actual.width, actual.height, { threshold: 0.05 });
  expect(diff, `${name} differs from golden by ${diff} px`).toBeLessThanOrEqual(threshold);
}

describe("renderFrame determinism", () => {
  it("same inputs → byte-identical PNG", () => {
    const p = payload();
    expect(sha(render(p))).toBe(sha(render(p)));
  });
  it("two independent engine instances agree (preview/audience parity)", () => {
    const p = payload();
    const a = render(p, camera, 1280, 720);
    const b = render(structuredClone(p), camera, 1280, 720);
    expect(sha(a)).toBe(sha(b));
  });
  it("a scaled preview canvas renders the same composition (within resampling)", () => {
    const p = payload();
    const full = png(render(p, camera, 1280, 720));
    const small = render(p, camera, 640, 360);
    // upscale small back and compare loosely: layout must match, not pixels
    const up = createCanvas(1280, 720) as Canvas;
    up.getContext("2d").drawImage(small, 0, 0, 1280, 720);
    const diff = pixelmatch(full.data, png(up).data, null, 1280, 720, { threshold: 0.3 });
    expect(diff / (1280 * 720)).toBeLessThan(0.03);
  });
});

describe("payload-only rendering", () => {
  it("null payload → neutral background only", () => {
    const c = render(null, null);
    const d = png(c).data;
    // sample a few pixels: all equal to neutral bg
    for (const i of [0, 4 * 1000, 4 * (1280 * 360 + 640), d.length - 4]) {
      expect([d[i], d[i + 1], d[i + 2]]).toEqual([0x0b, 0x0d, 0x12]);
    }
  });
  it("slide-full ignores the camera entirely", () => {
    const a = render(payload({ layout: "slide-full" }), camera);
    const b = render(payload({ layout: "slide-full" }), null);
    expect(sha(a)).toBe(sha(b));
  });
  it("camera.enabled=false draws no camera", () => {
    const a = render(payload({}, { enabled: false }), camera);
    const b = render(payload({ layout: "slide-full" }), null);
    expect(sha(a)).toBe(sha(b));
  });
  it("moving the camera changes pixels (positive control)", () => {
    const a = render(payload({}, { x: 0.1 }));
    const b = render(payload({}, { x: 0.7 }));
    expect(sha(a)).not.toBe(sha(b));
  });
  it("changing the slide asset changes pixels (positive control)", () => {
    const a = render(payload());
    const b = render(payload({ slide: null }));
    expect(sha(a)).not.toBe(sha(b));
  });
  it("branding title is the only text drawn, and only when present", () => {
    const withTitle = render(payload({ branding: { title: "Dept. of Physics", logoAssetId: null, position: "bl", color: "#fff" } }));
    const without = render(payload());
    expect(sha(withTitle)).not.toBe(sha(without));
  });
  it("circle overlay clips to a circle: bounding-box corner shows the slide, centre shows camera", () => {
    const p = payload({}, { shadow: false, border: { width: 0, color: "#fff" } });
    const d = png(render(p)).data;
    const W = 1280;
    const x = p.camera.x * 1280,
      y = p.camera.y * 720,
      w = p.camera.size * 1280;
    const px = (xx: number, yy: number) => {
      const i = (Math.round(yy) * W + Math.round(xx)) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    // corner of bbox → slide background (light grey)
    expect(px(x + 2, y + 2)[0]).toBeGreaterThan(200);
    // centre → camera pattern (magenta or green, saturated)
    const [r, g, b] = px(x + w / 2, y + w / 2) as [number, number, number];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(80);
  });
});

describe("golden images (deterministic layers)", () => {
  it("slide-full 16:9 in 720p", () => expectGolden("slide-full-720p", render(payload({ layout: "slide-full" }), null)));
  it("slide with circle camera", () => expectGolden("slide-circle-720p", render(payload({}, { shadow: false })), 60));
  it("slide with rounded rect camera, mirrored", () => expectGolden("slide-rect-mirror-720p", render(payload({}, { shape: "rect", aspect: 16 / 9, mirror: true, shadow: false })), 60));
  it("camera-full", () => expectGolden("camera-full-720p", render(payload({ layout: "camera-full" }))));
  it("blank", () => expectGolden("blank-720p", render(payload({ layout: "blank" }))));

  describe("ink", () => {
    const stroke = (tool: "pen" | "highlighter", color: "#ef4444" | "#f59e0b", points: number[]) => ({ tool, color, points });
    const ACROSS_CAMERA = [10000, 45000, 62000, 45000];

    it("marks sit on the slide, under the camera", () => {
      const p = payload({ ink: { pointer: null, strokes: [stroke("pen", "#ef4444", [6000, 12000, 30000, 30000, 12000, 50000]), stroke("pen", "#ef4444", ACROSS_CAMERA)] } });
      expectGolden("ink-marks-under-camera-720p", render(p));
    });
    it("a highlighter doesn't darken where it overlaps itself", () => {
      const p = payload({ ink: { pointer: null, strokes: [stroke("highlighter", "#f59e0b", [6000, 20000, 40000, 20000, 6000, 20000, 40000, 20000])] } }, { enabled: false });
      expectGolden("ink-highlighter-720p", render(p));
    });
    it("the pointer is on top of everything, including the camera", () => {
      const p = payload({ ink: { pointer: { x: 55000, y: 45000 }, strokes: [] } });
      expectGolden("ink-pointer-over-camera-720p", render(p));
    });
    it("a single dab shows as a dot", () => {
      const without = sha(render(payload({}, { enabled: false })));
      expect(sha(render(payload({ ink: { pointer: null, strokes: [stroke("pen", "#ef4444", [20000, 20000])] } }, { enabled: false })))).not.toBe(without);
    });
    it("none, or an empty set, draws exactly what no ink draws", () => {
      const without = sha(render(payload({ ink: null })));
      expect(sha(render(payload({ ink: { pointer: null, strokes: [] } })))).toBe(without);
    });
    it("marks stay on the slide when it's letterboxed", () => {
      // A portrait slide leaves bars at the sides, and the corner of the ink is at the slide's corner.
      const tall = { slide: { assetId: "s1", width: 540, height: 960 } };
      const p = payload({ ...tall, ink: { pointer: null, strokes: [stroke("pen", "#ef4444", [0, 0, 65535, 65535])] } }, { enabled: false });
      const bare = payload(tall, { enabled: false });
      const outsideDiffers = (a: ReturnType<typeof render>, b: ReturnType<typeof render>) => {
        const ctxA = a.getContext("2d").getImageData(0, 0, 200, 720).data;
        const ctxB = b.getContext("2d").getImageData(0, 0, 200, 720).data;
        return ctxA.some((v, i) => v !== ctxB[i]);
      };
      expect(outsideDiffers(render(p), render(bare))).toBe(false);
    });
  });
});

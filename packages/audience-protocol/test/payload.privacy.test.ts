/**
 * Privacy test P1 — schema whitelist (property-based).
 *
 * Feeds randomised "app state", including private fields with canary strings,
 * into the payload builder and asserts:
 *   1. The output passes the strict schema.
 *   2. Its key set deep-equals the allow-list (no extra keys ever appear).
 *   3. No canary string appears anywhere in the serialised payload.
 *   4. The overlay is always inside the output rectangle.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  AUDIENCE_PAYLOAD_KEYS,
  AudiencePayloadSchema,
  BRANDING_KEYS,
  CAMERA_KEYS,
  OUTPUT_KEYS,
  SLIDE_KEYS,
  safeValidatePayload,
} from "../src/index";
import { INK_COLORS, INK_COORD_MAX, INK_KEYS, INK_STROKE_KEYS, MAX_INK_POINTS, MAX_INK_STROKES } from "../src/payload";
import { buildAudiencePayload, clampCamera, overlayHeightNormalised, type BuildPayloadInput } from "../src/build";

const CANARIES = ["CANARY-SCRIPT-9f2c", "CANARY-NOTES-4a71", "CANARY-TELEPROMPTER-b3e0", "CANARY-RECORDING-77d1", "CANARY-FILENAME-c0de"];

const profileArb = fc.constantFrom("480p", "720p", "1080p") as fc.Arbitrary<BuildPayloadInput["profile"]>;
const layoutArb = fc.constantFrom("slide-full", "slide-with-camera", "camera-full", "blank") as fc.Arbitrary<BuildPayloadInput["layout"]>;
const colorArb = fc.constantFrom("#ffffff", "#000000", "rgb(10, 20, 30)", "#0b0d12", "hsl(200, 50%, 40%)");
const slugArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,32}$/);

const cameraArb: fc.Arbitrary<BuildPayloadInput["camera"]> = fc.record({
  enabled: fc.boolean(),
  deviceId: fc.option(fc.stringMatching(/^[A-Za-z0-9+/=_-]{8,80}$/), { nil: null }),
  shape: fc.constantFrom("circle", "rect") as fc.Arbitrary<"circle" | "rect">,
  x: fc.double({ min: -5, max: 5, noNaN: true }),
  y: fc.double({ min: -5, max: 5, noNaN: true }),
  size: fc.double({ min: -1, max: 3, noNaN: true }),
  aspect: fc.double({ min: 0.01, max: 10, noNaN: true }),
  cornerRadius: fc.double({ min: -1, max: 2, noNaN: true }),
  borderWidth: fc.double({ min: -10, max: 200, noNaN: true }),
  borderColor: colorArb,
  shadow: fc.boolean(),
  mirror: fc.boolean(),
  opacity: fc.double({ min: -1, max: 2, noNaN: true }),
});

/** Public inputs only — but the *surrounding* state in the test carries private canaries. */
const inputArb: fc.Arbitrary<BuildPayloadInput> = fc.record({
  seq: fc.nat(),
  profile: profileArb,
  background: colorArb,
  layout: layoutArb,
  slide: fc.option(fc.record({ assetId: slugArb, width: fc.integer({ min: 1, max: 4096 }), height: fc.integer({ min: 1, max: 4096 }) }), { nil: null }),
  camera: cameraArb,
  branding: fc.option(
    fc.record({
      title: fc.option(fc.string({ maxLength: 300 }).filter((s) => !/[\u0000-\u001f]/.test(s)), { nil: null }),
      logoAssetId: fc.option(slugArb, { nil: null }),
      position: fc.constantFrom("tl", "tr", "bl", "br") as fc.Arbitrary<"tl" | "tr" | "bl" | "br">,
      color: colorArb,
    }),
    { nil: null },
  ),
  // Deliberately includes junk numbers and over-long strokes: none may break a payload.
  ink: fc.option(
    fc.record({
      pointer: fc.option(fc.record({ x: fc.double(), y: fc.double() }), { nil: null }),
      strokes: fc.array(
        fc.record({
          tool: fc.constantFrom("pen", "highlighter") as fc.Arbitrary<"pen" | "highlighter">,
          color: fc.constantFrom(...INK_COLORS),
          points: fc.array(fc.double(), { maxLength: 40 }),
        }),
        { maxLength: 6 },
      ),
    }),
    { nil: null },
  ),
});

/** Simulates the full presenter app state. Private slices are full of canaries. */
const appStateArb = fc.record({
  public: inputArb,
  private: fc.record({
    script: fc.constant(CANARIES[0]),
    notes: fc.constant(CANARIES[1]),
    teleprompter: fc.record({ position: fc.nat(), text: fc.constant(CANARIES[2]) }),
    recording: fc.record({ state: fc.constant(CANARIES[3]) }),
    fileName: fc.constant(CANARIES[4]),
  }),
});

describe("P1: AudiencePayload whitelist", () => {
  it("builder output always passes the strict schema and has exactly the allow-listed keys", () => {
    fc.assert(
      fc.property(appStateArb, (state) => {
        const payload = buildAudiencePayload(state.public);
        expect(AudiencePayloadSchema.safeParse(payload).success).toBe(true);
        expect(Object.keys(payload)).toEqual([...AUDIENCE_PAYLOAD_KEYS]);
        expect(Object.keys(payload.output)).toEqual([...OUTPUT_KEYS]);
        expect(Object.keys(payload.camera)).toEqual([...CAMERA_KEYS]);
        if (payload.slide) expect(Object.keys(payload.slide)).toEqual([...SLIDE_KEYS]);
        if (payload.branding) expect(Object.keys(payload.branding)).toEqual([...BRANDING_KEYS]);
      }),
      { numRuns: 500 },
    );
  });

  it("no private canary can ever appear in a serialised payload", () => {
    fc.assert(
      fc.property(appStateArb, (state) => {
        const json = JSON.stringify(buildAudiencePayload(state.public));
        for (const c of CANARIES) expect(json).not.toContain(c);
      }),
      { numRuns: 500 },
    );
  });

  it("overlay geometry is always inside the output rectangle", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const p = buildAudiencePayload(input);
        const { width, height } = p.output;
        const h = overlayHeightNormalised(p.camera.size, p.camera.aspect, width, height);
        expect(p.camera.x).toBeGreaterThanOrEqual(0);
        expect(p.camera.y).toBeGreaterThanOrEqual(0);
        expect(p.camera.x + p.camera.size).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.camera.y + h).toBeLessThanOrEqual(1 + 1e-9);
        if (p.camera.shape === "circle") expect(p.camera.aspect).toBe(1);
      }),
      { numRuns: 500 },
    );
  });

  it("branding title is capped at the maximum length", () => {
    const p = buildAudiencePayload({
      seq: 1,
      profile: "720p",
      background: "#000",
      layout: "slide-full",
      slide: null,
      camera: { enabled: false, deviceId: null, shape: "circle", x: 0, y: 0, size: 0.2, aspect: 1, cornerRadius: 0, borderWidth: 0, borderColor: "#fff", shadow: false, mirror: false, opacity: 1 },
      branding: { title: "x".repeat(1000), logoAssetId: null, position: "tl", color: "#fff" },
      ink: null,
    });
    expect(p.branding?.title?.length).toBe(120);
  });
});

describe("P1: strict schema rejects smuggled fields", () => {
  const base = buildAudiencePayload({
    seq: 0,
    profile: "1080p",
    background: "#000",
    layout: "slide-with-camera",
    slide: { assetId: "s1", width: 1920, height: 1080 },
    camera: { enabled: true, deviceId: "abc", shape: "circle", x: 0.7, y: 0.6, size: 0.2, aspect: 1, cornerRadius: 0, borderWidth: 2, borderColor: "#fff", shadow: true, mirror: false, opacity: 1 },
    branding: null,
    ink: null,
  });

  it("rejects an unknown top-level key", () => {
    const r = safeValidatePayload({ ...base, script: "hello" });
    expect(r.ok).toBe(false);
  });
  it("rejects an unknown nested key", () => {
    const r = safeValidatePayload({ ...base, camera: { ...base.camera, label: "Logitech C920" } });
    expect(r.ok).toBe(false);
  });
  it("rejects an over-long branding title", () => {
    const r = safeValidatePayload({ ...base, branding: { title: "x".repeat(121), logoAssetId: null, position: "tl", color: "#fff" } });
    expect(r.ok).toBe(false);
  });
  it("rejects a mismatched profile/dimension pair", () => {
    const r = safeValidatePayload({ ...base, output: { ...base.output, width: 1280 } });
    expect(r.ok).toBe(false);
  });
  it("rejects an unsafe colour string", () => {
    const r = safeValidatePayload({ ...base, output: { ...base.output, background: "url(javascript:alert(1))" } });
    expect(r.ok).toBe(false);
  });
});

describe("clampCamera", () => {
  it("clamps an overlay dragged off the right edge", () => {
    const c = clampCamera({ enabled: true, deviceId: null, shape: "circle", x: 0.95, y: 0.5, size: 0.2, aspect: 1, cornerRadius: 0, borderWidth: 0, borderColor: "#fff", shadow: false, mirror: false, opacity: 1 }, 1920, 1080);
    expect(c.x).toBeCloseTo(0.8);
  });
  it("shrinks a circle that would be taller than the output", () => {
    const c = clampCamera({ enabled: true, deviceId: null, shape: "circle", x: 0, y: 0, size: 1, aspect: 1, cornerRadius: 0, borderWidth: 0, borderColor: "#fff", shadow: false, mirror: false, opacity: 1 }, 1920, 1080);
    expect(c.size).toBeCloseTo(1080 / 1920);
  });
});

describe("P1: ink carries only numbers and a fixed palette, within limits", () => {
  const camera = { enabled: false, deviceId: null, shape: "circle", x: 0.7, y: 0.6, size: 0.2, aspect: 1, cornerRadius: 0, borderWidth: 2, borderColor: "#fff", shadow: true, mirror: false, opacity: 1 } as const;
  const input = (ink: BuildPayloadInput["ink"], over: Partial<BuildPayloadInput> = {}): BuildPayloadInput => ({ seq: 1, profile: "1080p", background: "#000", layout: "slide-full", slide: { assetId: "s1", width: 1920, height: 1080 }, camera, branding: null, ink, ...over });
  const stroke = (points: number[]) => ({ tool: "pen" as const, color: INK_COLORS[0], points });
  const withInk = (ink: unknown) => safeValidatePayload({ ...buildAudiencePayload(input(null)), ink });

  it("has exactly the allowed keys", () => {
    const p = buildAudiencePayload(input({ pointer: { x: 1, y: 2 }, strokes: [stroke([1, 2, 3, 4])] }));
    expect(Object.keys(p.ink!)).toEqual([...INK_KEYS]);
    expect(Object.keys(p.ink!.strokes[0]!)).toEqual([...INK_STROKE_KEYS]);
  });
  it("rejects smuggled fields and text", () => {
    const good = { tool: "pen", color: INK_COLORS[0], points: [1, 2] };
    expect(withInk({ pointer: null, strokes: [good] }).ok).toBe(true);
    expect(withInk({ pointer: null, strokes: [good], note: "x" }).ok).toBe(false);
    expect(withInk({ pointer: null, strokes: [{ ...good, label: "x" }] }).ok).toBe(false);
    expect(withInk({ pointer: { x: 1, y: 2, label: "x" }, strokes: [] }).ok).toBe(false);
    expect(withInk({ pointer: null, strokes: [{ ...good, color: "secret words" }] }).ok).toBe(false);
    expect(withInk({ pointer: null, strokes: [{ ...good, points: ["a", "b"] }] }).ok).toBe(false);
  });
  it("the schema itself enforces the limits, for anything that didn't come through the builder", () => {
    const pen = (points: number[]) => ({ tool: "pen", color: INK_COLORS[0], points });
    expect(withInk({ pointer: null, strokes: [pen([1, 2, 3])] }).ok).toBe(false); // odd count
    expect(withInk({ pointer: null, strokes: [pen([1.5, 2])] }).ok).toBe(false); // not an integer
    expect(withInk({ pointer: null, strokes: [pen([INK_COORD_MAX + 1, 2])] }).ok).toBe(false);
    expect(withInk({ pointer: null, strokes: Array(MAX_INK_STROKES + 1).fill(pen([1, 2])) }).ok).toBe(false);
    const half = Array(MAX_INK_POINTS * 2 - 2).fill(1);
    expect(withInk({ pointer: null, strokes: [pen(half), pen([1, 2])] }).ok).toBe(true);
    expect(withInk({ pointer: null, strokes: [pen(half), pen([1, 2, 3, 4, 5, 6])] }).ok).toBe(false);
  });
  it("the builder trims too much ink rather than throwing, since a throw would stop all output", () => {
    const tooLong = Array(MAX_INK_POINTS * 3).fill(100);
    const many = Array(MAX_INK_STROKES + 50).fill(stroke([1, 2]));
    expect(buildAudiencePayload(input({ pointer: null, strokes: [stroke(tooLong)] })).ink!.strokes[0]!.points.length).toBe(MAX_INK_POINTS * 2);
    expect(buildAudiencePayload(input({ pointer: null, strokes: many })).ink!.strokes.length).toBe(MAX_INK_STROKES);
  });
  it("cleans bad numbers", () => {
    const p = buildAudiencePayload(input({ pointer: { x: NaN, y: 2 }, strokes: [stroke([NaN, 2, -5, 1e9, 3.4, 5.6, Infinity, 1])] }));
    expect(p.ink?.pointer).toBeNull();
    expect(p.ink?.strokes[0]!.points).toEqual([0, INK_COORD_MAX, 3, 6]);
  });
  it("sends none when no slide is showing", () => {
    const ink = { pointer: { x: 1, y: 2 }, strokes: [stroke([1, 2])] };
    expect(buildAudiencePayload(input(ink, { layout: "camera-full" })).ink).toBeNull();
    expect(buildAudiencePayload(input(ink, { layout: "blank" })).ink).toBeNull();
    expect(buildAudiencePayload(input(ink, { slide: null })).ink).toBeNull();
    expect(buildAudiencePayload(input({ pointer: null, strokes: [] })).ink).toBeNull();
  });
});

/**
 * AUDIENCE WINDOW BOOTSTRAP.
 *
 * Rules (enforced by .dependency-cruiser.cjs and privacy tests P3/P6/P7):
 *   - No React. No Zustand. No router. No database.
 *   - Imports ONLY from @bernou/audience-protocol, @bernou/composition-engine
 *     and files in this directory.
 *   - All state arrives as validated AudiencePayload messages over the channel.
 *   - The DOM contains exactly one <canvas>. No text, no controls.
 *
 * Lifecycle:
 *   1. paint neutral frame, open channel, send `hello`
 *   2. presenter replies with `payload` (and `asset` blobs on request)
 *   3. engine renders payload + cached assets + re-acquired camera
 *   4. `blank`/`bye` → neutral frame, camera released
 */
import { AudienceChannel, isBroadcastChannelSupported, type AudiencePayload } from "@bernou/audience-protocol";
import { createAssetCache, createEngine, NEUTRAL_BACKGROUND } from "@bernou/composition-engine";
import { createAudienceCamera } from "./cameraSource";

const canvas = document.getElementById("audience-canvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("audience canvas missing");

// Identify this window to same-origin capturers (Chromium Capture Handle), so
// the presenter app could detect self-capture later. Harmless elsewhere.
try {
  (navigator.mediaDevices as unknown as { setCaptureHandleConfig?: (c: { handle: string; permittedOrigins: string[] }) => void }).setCaptureHandleConfig?.({ handle: "bernou-audience", permittedOrigins: [location.origin] });
} catch {
  /* unsupported */
}

const cache = createAssetCache(128);
const camera = createAudienceCamera();
const engine = createEngine(canvas, { assets: cache }, {}, 30);
engine.resize(1920, 1080);
engine.renderNow(); // neutral frame immediately, never a white window
engine.start();

let current: AudiencePayload | null = null;
let lastSeq = -1;
const requested = new Set<string>();

function applyPayload(p: AudiencePayload) {
  if (p.seq <= lastSeq) return; // last-writer-wins, ignore stale
  lastSeq = p.seq;
  current = p;
  engine.resize(p.output.width, p.output.height);
  engine.setPayload(p);
  // camera follows the payload's deviceId
  const wantCam = p.camera.enabled && p.layout !== "slide-full" && p.layout !== "blank" ? p.camera.deviceId : null;
  void camera.use(wantCam).then(() => engine.setCamera(camera.source));
  // request any asset we don't have
  const need = [p.slide?.assetId, p.branding?.logoAssetId].filter((x): x is string => !!x);
  for (const id of need) {
    if (!cache.has(id) && !requested.has(id)) {
      requested.add(id);
      channel?.send({ type: "asset-request", assetId: id });
    }
  }
}

function blank() {
  current = null;
  engine.setPayload(null);
  camera.release();
  engine.setCamera(null);
  engine.renderNow();
}

let channel: AudienceChannel<"audience"> | null = null;
if (isBroadcastChannelSupported()) {
  channel = new AudienceChannel("audience");
  channel.onMessage((m) => {
    switch (m.type) {
      case "payload":
        applyPayload(m.payload);
        break;
      case "asset":
        if (m.blob.type !== m.mime) return; // re-check the declared type
        void cache.put(m.assetId, m.blob).then(() => {
          requested.delete(m.assetId);
          engine.renderNow();
        });
        break;
      case "blank":
      case "bye":
        blank();
        break;
    }
  });
  channel.send({ type: "hello", from: "audience" });
  // Re-announce if the presenter was not there yet (it replies when it mounts).
  const retry = setInterval(() => {
    if (current) clearInterval(retry);
    else channel?.send({ type: "hello", from: "audience" });
  }, 1000);
  window.addEventListener("pagehide", () => {
    clearInterval(retry);
    camera.release();
    engine.stop();
    channel?.close();
  });
}

// Double-click or F key → fullscreen; Esc leaves (browser default).
const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
};
window.addEventListener("dblclick", toggleFullscreen);
window.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") toggleFullscreen();
});

// Keep the canvas crisp when the window is resized: CSS handles scaling
// (object-fit: contain); the backing store stays at output resolution.

// Expose a read-only diagnostic for tests (frame count, seq). No setters.
Object.defineProperty(window, "__bernouAudience", {
  value: Object.freeze({ frames: () => engine.frameCount(), seq: () => lastSeq, mode: () => engine.scheduler().mode(), background: NEUTRAL_BACKGROUND }),
  writable: false,
});

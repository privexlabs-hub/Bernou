/**
 * AUDIENCE WINDOW BOOTSTRAP.
 *
 * Rules (enforced by .dependency-cruiser.cjs and privacy tests P3/P6/P7):
 *   - No React. No Zustand. No router. No database.
 *   - Imports ONLY from @bernou/audience-protocol and @bernou/composition-engine.
 *   - All state arrives as validated AudiencePayload messages over the channel.
 *   - The DOM contains exactly one <canvas>. No text, no controls.
 *
 * Engine wiring is completed in step 2.9. At scaffold time this file
 * establishes the channel and paints a neutral frame so the window is never
 * blank-white when shared.
 */
import { AudienceChannel, isBroadcastChannelSupported } from "@bernou/audience-protocol";

const canvas = document.getElementById("audience-canvas") as HTMLCanvasElement | null;
if (!canvas) throw new Error("audience canvas missing");

function paintNeutral(c: HTMLCanvasElement) {
  c.width = 1920;
  c.height = 1080;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, c.width, c.height);
}
paintNeutral(canvas);

if (isBroadcastChannelSupported()) {
  const channel = new AudienceChannel("audience");
  channel.onMessage((m) => {
    // Step 2.9 routes payload/asset messages into the composition engine.
    if (m.type === "blank" || m.type === "bye") paintNeutral(canvas);
  });
  channel.send({ type: "hello", from: "audience" });
  window.addEventListener("pagehide", () => channel.close());
}

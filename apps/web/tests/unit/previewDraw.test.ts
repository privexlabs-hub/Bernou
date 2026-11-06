import { describe, expect, it } from "vitest";
import { createPreviewDraw } from "@/features/preview/previewHandle";

/** An engine whose own loop "draws" when `loopFrame()` is called while it's running. */
function fakeEngine() {
  let frames = 0;
  let running = true;
  const e = {
    renders: 0,
    frameCount: () => frames,
    renderNow: () => {
      frames++;
      e.renders++;
    },
    start: () => void (running = true),
    stop: () => void (running = false),
    running: () => running,
    loopFrame: () => {
      if (running) e.renderNow();
    },
  };
  return e;
}

describe("the preview's draw for the recorder", () => {
  it("not recording: skips its own draw when the loop already drew", () => {
    const eng = fakeEngine();
    const p = createPreviewDraw(eng);
    eng.loopFrame();
    p.draw();
    expect(eng.renders).toBe(1);
    p.draw(); // nothing drawn since: draws
    expect(eng.renders).toBe(2);
  });

  it("recording: the loop stops and every recorder tick draws, once", () => {
    const eng = fakeEngine();
    const p = createPreviewDraw(eng);
    const release = p.capture();
    expect(eng.running()).toBe(false);
    eng.loopFrame(); // the display would have drawn: it doesn't any more
    for (let i = 0; i < 30; i++) p.draw();
    expect(eng.renders).toBe(30);
    release();
    expect(eng.running()).toBe(true);
  });

  it("releasing twice, or after the preview has gone, doesn't restart a stopped engine", () => {
    const eng = fakeEngine();
    const p = createPreviewDraw(eng);
    const release = p.capture();
    release();
    eng.stop();
    release();
    expect(eng.running()).toBe(false);

    const again = p.capture();
    p.dispose();
    again();
    expect(eng.running()).toBe(false);
  });
});

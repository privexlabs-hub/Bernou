# Bernou privacy model

The defining feature of Bernou is that the audience output is **generated independently** from the presenter workspace. This document states the guarantee, the threat model, and the four enforcement layers.

## Guarantee

The audience output (the preview canvas, every recording, and the audience-only window) is drawn by the composition engine from exactly one input: a validated `AudiencePayload`, plus live frames from a camera the payload names by `deviceId`.

Nothing else reaches the engine. In particular, the following never cross the boundary:

| Never crosses | Where it lives instead |
|---|---|
| Speech script, sections, section titles | `stores/private/scriptStore` + IndexedDB |
| Teleprompter state (position, speed, font, colours) | `stores/private/teleprompterStore` |
| Speaker notes | `stores/private/notesStore` + IndexedDB |
| Recording state, controls, timer | `stores/private/recordingStore` |
| Microphone device list, levels, mute | `stores/private/devicesStore` |
| Session name, file names, deck title, slide text layers | `db/`, `stores/public/deckStore` (rasterised bitmaps only cross) |
| Navigation UI | React tree in the presenter window only |

Ink (pen and highlighter marks, and the pointer) crosses on purpose, because it's meant to be seen. It's integers and a fixed palette of colours, for the active slide only, with limits enforced by the schema on both send and receive.

The **only free text** in the payload is `branding.title`: set in a field labelled "visible to audience", capped at 120 characters.

A recording holds the composition plus the microphone through the audio graph. It is kept in this browser (OPFS) until the presenter downloads or deletes it. Starting or stopping one publishes nothing to the audience, and the session title appears only in the downloaded file's name.

## What "independent" means here

- Privacy is **not** CSS. No element is hidden to make it private.
- The audience window is a **separate Vite entry** (`audience.html` → `src/audience/main.ts`). It contains one `<canvas>`, no React, no stores, no router, no database.
- The presenter's preview and the audience window run **the same engine on the same payload**, so the preview is not an approximation.
- The webcam reaches the audience window by **re-acquiring the camera by `deviceId`** in that window (option 1 in the architecture). A `MediaStream` is never shared across windows. Chromium can give one camera a different id in each window: with exactly one real camera listed it is opened by its own id; otherwise the window reports an error rather than guess.
- The audience window reports back only a heartbeat and a camera error code (`audience-status`, `audience-bye`): never names, labels or browser text.

## Threat model

| Threat | Covered by |
|---|---|
| A developer adds a private field to the payload | Layer 1 (closed type) + Layer 2 (strict schema) + P1 property test + CODEOWNERS |
| A developer imports a private store into audience/engine code | Layer 3 (dependency-cruiser) + P6 meta-test + P7 bundle audit |
| A refactor makes the preview render something the audience window does not, or vice versa | Parity test (same engine, same payload, pixel-equal) |
| Private state changes alter the audience canvas indirectly | P4 differential pixel test (+ P5 positive control) |
| Imported content itself carries notes (PPTX notes slides, "notes pages" PDFs) | P8 import test; importer never rasterises `ppt/notesSlides/*`; notes-page PDF warning |
| A hostile message on the BroadcastChannel from another same-origin tab | Inbound validation drops it; channel is same-origin only |
| Screen-sharing the wrong window | Documentation + distinct, stable audience window title + Capture Handle |
| Capture continues after the presenter thinks it stopped | P9, P9b, P9c: Emergency Stop ends every track, including starts still in flight in either window, and stops the recorder first; indicators driven by `track.readyState` |

The floating prompter is presenter-only DOM like the Prompter tab: a portal of the same React tree into a Picture-in-Picture window, reading only private stores. Its slide buttons change the slide through the public deck store, as any slide change does. Opening, playing and resizing it publishes nothing (`prompter.float.spec`). **It is a real window on screen**, so an entire-screen share shows it.

The editor is presenter-only. It reads a recording's file and writes a new one, all in this browser; nothing is uploaded, and the noise model runs locally. It never touches the audience channel. Text added as an overlay is put into the exported video on purpose.

**Out of scope:** an attacker with code execution on the presenter's machine; the presenter choosing to share their whole screen instead of the audience window; conferencing-app bugs.

## Four enforcement layers

1. **Type layer** — `AudiencePayload` is a closed interface. `buildAudiencePayload()` takes individually named public values, never a store object.
2. **Runtime layer** — `AudiencePayloadSchema` is `.strict()` at every level; unknown keys are rejected on both send and receive. Strings are length-capped and colour strings are pattern-checked.
3. **Build layer** — `.dependency-cruiser.cjs` forbids audience/engine code from importing any private module, any store, or any unresolvable path. `scripts/boundary-meta-test.mjs` proves the rules reject a planted leak. `scripts/bundle-privacy-check.mjs` greps the built audience chunks.
4. **Test layer** — privacy suite P1–P9 (see `docs/ARCHITECTURE.md` §7.2 and `apps/web/tests/privacy`).

`pnpm check` runs layers 1–3 and the unit-level part of layer 4. `pnpm test:e2e` runs the browser-level privacy tests.

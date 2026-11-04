# Known limitations and incomplete functionality

Maintained per the spec (§14): nothing is marked complete unless implemented and tested. Updated at the end of every development step.

## Status after Stage SECOND (MVP milestone, steps 2.1–2.10) and recording

### Acceptance criteria (spec §14)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| AC1 | Create a presentation session | ✅ | `session.create.spec`, `dashboard.test.tsx`, `sessions.repo.test.ts` |
| AC2 | Import and navigate slides | ✅ (PDF, images) / ⚠️ PPTX via PDF export | `pdf.import.spec`, `pdfImporter.test.ts` |
| AC3 | Paste and edit a speech | ✅ | `script.notes.spec` (10,800-word paste, 400 sections), `scriptStore.test.ts` |
| AC4 | Control teleprompter scrolling | ✅ | `teleprompter.spec` ×3, `scrollModel.test.ts` |
| AC5 | Activate webcam | ✅ fake devices · ⏳ **real camera confirmation pending** | `media.spec`, `camera.matrix.spec` (toggle, dropdown including before any permission, preview hint, frames moving, injected errors, reload) |
| AC6 | Select microphone | ✅ | `media.spec` (device list, level meter rises, mute) |
| AC7 | Move and resize overlay | ✅ | `media.spec` (drag, corner resize, clamping, shape) |
| AC8 | Preview updates immediately | ✅ | `media.spec` (pixel hash changes < 500 ms, ≤ 2 frames) |
| AC9 | Audience window shows the correct composition | ✅ | `audience.window.spec` (matches the preview within 2/255 per channel: separate draws of slide text can differ by 1), `audience.camera.spec`, `emergency.race.spec` |
| AC10 | Scripts never in audience output | ✅ | P1 (fuzz), P2 (channel canary), P3 (DOM), P4 (pixels), P6, P7 |
| AC11 | Notes never in audience output | ✅ | same suite |
| AC12 | Recording controls never in audience output | ✅ | P3 DOM audit (no buttons/inputs) + P7 bundle audit (now also forbids the recording APIs in audience chunks); recording leaves the payload unchanged (`recording.spec`) |
| AC13 | Private changes don't change the audience output | ✅ | P4 differential pixel test + P5 positive controls |
| AC14 | Audience output selectable for conferencing | ✅ automated part (separate OS window, stable title "Bernou — Audience", capture handle) · ⏳ **manual QA matrix (Zoom/Meet/Teams on Windows/macOS) not yet run** |

### Feature status

| Area | Status | Notes |
|---|---|---|
| Privacy boundary | ✅ | 4 layers: closed type, strict Zod schema, dependency-cruiser rules + meta-test, bundle audit; privacy suite P1–P9 |
| Dashboard, sessions, persistence | ✅ | IndexedDB (Dexie). No network anywhere. |
| PDF import | ✅ | PDF.js 4.x, pages rasterised to PNG at output resolution (1920 px on the long edge), thumbnails. Notes-pages heuristic warns (P8). Decks imported before this fix keep their lower-resolution slides until imported again. |
| Image import | ✅ | PNG/JPEG/WebP, one slide per image |
| PPTX import | ⚠️ | **Refused with guidance** to export to PDF. No faithful in-browser renderer exists; Stage FOURTH. |
| Composition engine | ✅ | Slide (letterbox), camera (circle/rect, cover-fit, mirror, border, shadow, opacity), branding title; golden + determinism tests |
| Audience preview | ✅ | Same engine at real output resolution, CSS-scaled |
| Camera / microphone | ✅ | Selection, labels after grant, `devicechange`, error guidance, level meter, mute via gain, never routed to speakers |
| Overlay interaction | ✅ | Drag, corner resize, keyboard nudge, double-click shape toggle, corner presets; clamped in the protocol |
| Script editor | ✅ | Paste, sections, split at blank lines, reorder, delete, slide links, autosave |
| Speaker notes | ✅ | Per slide, autosave, shows linked script sections |
| Teleprompter | ✅ | Time-based scroll model; start/pause/resume/stop/reset; speed 1–400 px/s/font/colours/alignment/reading line & zone/mirror; manual wheel+keys; progress + time remaining. Holds its place while another tab or browser tab is showing. Follow slides is optional and off by default: slide → prompter only, first linked section, no link means no jump |
| Slide links in the script | ✅ | Optional. A linked section is listed under that slide in Notes, and is the target for Follow slides. Every section shows in the prompter, in script order, linked or not |
| Pointer, pen, highlighter, eraser | ✅ Chrome · ✅ Firefox smoke test | Through the payload and engine, so the preview, audience window and recordings match. Marks stay per slide until cleared, up to 200 strokes and 5,000 points a slide. No text tool |
| Audience window | ✅ | Separate Vite entry; BroadcastChannel; camera re-acquired by deviceId (video only); fullscreen; resync after either window reloads; blank on stop; camera problems reported to the presenter |
| Emergency stop & indicators | ✅ | Stops the recorder and keeps the file, ends every track including starts still in flight, blanks audience, indicators from `track.readyState` (P9, P9b, P9c) |
| Branding title/logo | ⚠️ | Engine supports it; **no UI yet** to set the audience-visible title (planned with Stage THIRD polish). Logo assets not wired. |
| Panel collapse/resize | ✅ | `react-resizable-panels`, sizes persisted in localStorage |
| Recording and download | ✅ Chrome · ✅ Firefox smoke test · ❓ Safari untested | Audience composition plus microphone only; other meeting participants aren't recorded. MP4, else WebM. See below. `recording.spec` |
| Compression, trimming, export options | ⏳ | Not started |
| Browser-content capture | ⏳ | Stage FOURTH — always needs the browser's own picker |
| Voice-following teleprompter | ⏳ | Stage FOURTH — opt-in, on-device only |
| Native virtual camera | ❌ | Not possible in a browser. Stage FOURTH desktop build. Interim: OBS Virtual Camera with the audience window as a source. |
| MP4 recording in Firefox | ❌ | Firefox produced WebM when tested (157). The file extension and dashboard row say so. |

### Recording: what was measured

Output of real runs, not estimates. All with fake media devices on one Intel Mac; **a real camera and microphone, and playback in QuickTime, are not yet confirmed.**

| Case | Result |
|---|---|
| Chrome, tab hidden 6.5 min, camera on (MP4) | 25 fps hidden, 30 visible; slide changes in the file within 1s; audio present every second; video and audio lengths equal (403.4s) |
| Chrome, tab hidden 45s, camera off | 30 fps |
| Playwright's headless Chromium, 1080p still slide | 11–18 fps: no GPU, so the recorder sheds frames. Tests allow 8 here and require 20 on Chrome. |
| Ink at the 5,000-point cap, with recording, camera and audience window, on the dev build | Median frame 32 ms, worst 133 ms, audience kept updating (one run) |
| Firefox 157 | WebM with audio and a finite duration; 6s smoke test only, since the media E2E suite is Chromium-only |

- **Testing hidden tabs**: Playwright keeps every page "visible" through focus emulation, so no Playwright test exercises this, including `recording.spec`. The hidden-tab numbers came from a one-off script driving Chrome directly, which isn't in the repo or CI. Re-measure after changing the frame clock, canvas drawing or payload scheduling.
- **Fake microphone**: Chrome's file-based fake mic read silent in that script before any app code ran, so hidden-tab audio was measured with an oscillator standing in for the mic.
- **After a crash**: the file holds what had reached storage, about 2 seconds short of the end (the keyframe interval), and is marked Interrupted. Its duration and row size come from the last save.
- **WebM seeking**: duration is patched in at download, but there is no seek index, so seeking may be coarse.
- **Mic off during a recording** keeps the file's full length, with silence for that stretch. It used to stop the audio track, and could cut the file short.
- **Slow machines** lose frames rather than freeze. There's no on-screen warning when this happens.
- **Without OPFS** a recording is held in memory, capped at 500 MB and lost on reload, with a warning. This path has no test.
- **Long recordings**: the longest test was 6.7 minutes. Hour-long runs, memory use and audio drift over them are unmeasured.
- **Exactly as presented** means the composition the preview draws. The audience window opens its own camera, so its frames aren't the same frames, and if its camera fails the recording still shows the presenter's.

### Audience window sharpness

The output is fixed at 1920×1080. On a Retina screen the audience window stretches that (measured: 1.46× at a 2796 px wide window), so text is softer than a PDF viewer, which redraws at screen resolution. Colours match the PDF's values exactly in the sample deck; comparing with a macOS viewer hasn't been done.

### Deploying

Not yet deployed anywhere, so this is untested. `audience.html` is built as its own page and is served as a static file. Reloading `/studio/...` on a static host needs a rewrite to `index.html`. Presentations and recordings are stored per website address, so they don't move between `localhost` and a deployed site. The repo holds both `pnpm-lock.yaml` and `package-lock.json`, and the project uses pnpm.

### Browser limitations that affect the MVP

- **Popup blockers**: the audience window is opened with `window.open` from a click; if blocked, the UI says so. It cannot be opened without a user gesture.
- **Background throttling**: a minimised audience window may be throttled by the OS/browser. The scheduler falls back to a Worker tick when `document.hidden`, but OS-level occlusion is outside our control. Guidance: keep the window un-minimised while sharing.
- **Two camera consumers**: the audience window re-opens the camera. Most drivers allow this; some Windows USB drivers do not (`NotReadableError`). The fallback (single renderer streamed over a same-origin WebRTC loopback) is designed but **not implemented** — needs hardware QA first.
- **Storage eviction**: Safari may evict script-written storage after 7 days without interaction. Recordings must be downloaded promptly.
- **Firefox/WebKit E2E**: the fake-media suites are Chromium-only (`--use-file-for-fake-video-capture`). `@nomedia` specs run in all three projects in CI; media specs are skipped elsewhere.

### Test environment note

E2E was run on Playwright's Chromium and on system Chrome (`PW_CHROME_CHANNEL=chrome`). Firefox was run: its `@nomedia` specs passed and its media specs are skipped by design. **WebKit E2E has not been executed.** Machine load affects the timing-sensitive specs, so don't run other heavy work beside them.

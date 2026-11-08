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
| Camera / microphone | ✅ | Selection, labels after grant, `devicechange`, error guidance, level meter, mute via gain, never routed to speakers. The browser's noise suppression, echo cancellation and auto gain are requested and checked on (on Chromium's fake device) |
| Recording low-cut filter | ✅ Chrome | Always on, 80 Hz Butterworth high-pass before the recorder. Measured in a recording: −12.3 dB at 40 Hz, −3.0 at 80 Hz, −0.3 at 150 Hz against 1 kHz. Removes rumble (wind buffeting, traffic and engine drone, handling noise, hum). **Does not** remove voices, birds, horns or hiss in the voice's own range: only the browser's suppression acts on those. Measured with a page-made test signal, which skips the browser's own processing, so how the two combine on a real mic is untested. Chrome's processing may already include a high-pass of its own (unverified). The level meter shows the sound before the filter. Outdoors, a windscreen or a clip-on mic near the mouth helps more than any filter. `recording.spec` |
| Overlay interaction | ✅ | Drag, corner resize, keyboard nudge, double-click shape toggle, corner presets; clamped in the protocol |
| Script editor | ✅ | Paste, sections, split at blank lines, reorder, delete, slide links, autosave |
| Speaker notes | ✅ | Per slide, autosave, shows linked script sections |
| Teleprompter | ✅ | Time-based scroll model; start/pause/resume/stop/reset; speed 1–400 px/s/font/colours/alignment/reading line & zone/mirror; manual wheel+keys; progress + time remaining. Holds its place while another tab or browser tab is showing. Follow slides is optional and off by default: slide → prompter only, first linked section, no link means no jump |
| Floating prompter | ✅ Chrome · ✅ Firefox · ✅ bundled Chromium · panel only in WebKit | **Float** in the Prompter tab moves the text into an always-on-top window (Document Picture-in-Picture) you drag next to the camera. Its controls: play/pause, speed, previous/next slide, bring back. Keys while it has focus: Space, ←/→ speed, ↑/↓ nudge, Esc, Home, PageUp/PageDown slides, the Stop all shortcut. Settings in the tab apply to it live. Moving between the tab and the window, or resizing, keeps the reading place. Stop all closes it. Browsers without the API (Safari) get a panel you can drag and resize **inside** the browser window only. See below. `prompter.float.spec`, `prompter.reflow.spec` |
| Slide links in the script | ✅ | Optional. A linked section is listed under that slide in Notes, and is the target for Follow slides. Every section shows in the prompter, in script order, linked or not |
| Pointer, pen, highlighter, eraser | ✅ Chrome · ✅ Firefox smoke test | Through the payload and engine, so the preview, audience window and recordings match. Marks stay per slide until cleared, up to 200 strokes and 5,000 points a slide. No text tool |
| Audience window | ✅ | Separate Vite entry; BroadcastChannel; camera re-acquired by deviceId (video only); fullscreen; resync after either window reloads; blank on stop; camera problems reported to the presenter |
| Emergency stop & indicators | ✅ | Stops the recorder and keeps the file, ends every track including starts still in flight, blanks audience, indicators from `track.readyState` (P9, P9b, P9c) |
| Branding title/logo | ⚠️ | Engine supports it; **no UI yet** to set the audience-visible title (planned with Stage THIRD polish). Logo assets not wired. |
| Panel collapse/resize | ✅ | `react-resizable-panels`, sizes persisted in localStorage |
| Recording and download | ✅ Chrome · ✅ Firefox smoke test · ❓ Safari untested | Audience composition plus microphone only; other meeting participants aren't recorded. MP4, else WebM. See below. `recording.spec` |
| Editor | ✅ Chrome · ✅ Firefox smoke test (WebM) · ❓ Safari untested | `/recordings/:id/edit`. Covers:<br>• trim, remove sections, smooth joins (0.5 s crossfade)<br>• volume, mute sections, background-noise removal (RNNoise, local, with strength), audio-only WAV<br>• text and highlight overlays<br>• brightness, contrast and saturation<br>• undo and redo, autosave<br><br>Never writes to the original. Export is a new recording: MP4 (H.264/AAC), or WebM (VP9/Opus) where the browser can't encode AAC, such as Firefox. See below. `editor.spec`, `editor.firefox.spec` |
| Compression, other export resolutions | ⏳ | Not started |
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

- **Busy machine, measured 2026-11-06** (Intel i7-1068NG7, Chrome 156, fake camera, audience window open, 30 s runs):
  - **Idle:** 30.2 fps, no frame held over 100 ms.
  - **With six CPU-burning processes:** 6–22 fps, with freezes of 300–400 ms. The same pattern as a user's 10-minute recording (18.6 fps).
  - **What stalls:** each recorder tick's task takes 50–150 ms, but Bernou's own work in it is about 1 ms (drawing about 0.7 ms). The rest is the browser's capture and encoding work.
  - **Since then:** the preview draws 30 times a second, not at every refresh, and during a recording each frame is drawn once, by the recorder's clock. That halves drawing and removed multi-second holes (longest frame 5–6.7 s before, under 0.5 s after). Under heavy load the frame rate improved in some alternating runs and not in others, so **a busy machine still stutters**.
  - Close heavy apps (a Docker VM was seen at about 130% CPU) before recording.
- **Recording in QuickTime and other Apple players**: Chrome's MP4 fragments don't add up to their own start times. Chrome plays them by start time, QuickTime by adding durations, and a 10-minute file came out 16 s short on video. Downloads now set each fragment's last sample to end where the next one starts (`fixMp4FragmentGaps`). Recordings downloaded before that fix need downloading again.
- **Testing hidden tabs**: Playwright keeps every page "visible" through focus emulation, so no Playwright test exercises this, including `recording.spec`. The hidden-tab numbers came from a one-off script driving Chrome directly, which isn't in the repo or CI. Re-measure after changing the frame clock, canvas drawing or payload scheduling.
- **Fake microphone**: Chrome's file-based fake mic read silent in that script before any app code ran, so hidden-tab audio was measured with an oscillator standing in for the mic.
- **After a crash**: the file holds what had reached storage, about 2 seconds short of the end (the keyframe interval), and is marked Interrupted. Its duration and row size come from the last save.
- **WebM seeking**: duration is patched in at download, but there is no seek index, so seeking may be coarse.
- **Mic off during a recording** keeps the file's full length, with silence for that stretch. It used to stop the audio track, and could cut the file short.
- **Slow machines** lose frames rather than freeze. There's no on-screen warning when this happens.
- **Without OPFS** a recording is held in memory, capped at 500 MB and lost on reload, with a warning. This path has no test.
- **Long recordings**: the longest test was 6.7 minutes. Hour-long runs, memory use and audio drift over them are unmeasured.
- **Exactly as presented** means the composition the preview draws. The audience window opens its own camera, so its frames aren't the same frames, and if its camera fails the recording still shows the presenter's.

### Floating prompter: what was measured and what it can't do

On Chrome 156, driving Chrome directly (not Playwright's focus emulation), one Intel Mac:

| Case | Result |
|---|---|
| Window size | 560×260 asked for, given exactly. Smallest Chrome allows is 240 wide; the largest it gave was 697×464 |
| Position and size after closing and reopening | Kept, in the same browser session. A page can't set the position: the presenter drags it once |
| Studio tab hidden or minimised | The window keeps animating (about 58 frames a second); scrolling at speed 40 measured 38.5–40.2 px/s; a slide change from it reached the audience window within 2 s; speed and slide keys exact across three logged runs |
| Firefox | The API is present and the spec passes in Playwright's Firefox |

- **Entire-screen sharing shows it.** Nothing in a browser can hide a window from a full-screen share, so viewers would read the script. Share the audience window, or a single window or tab. Bernou's own recordings never include it: they draw only from the audience payload.
- **Keys reach only the focused window.** With Zoom or another app focused, Space and a clicker go there, not to the floating prompter. Its buttons always work with a click.
- **Not measured:** keyboard focus right after it opens (automation reported both windows as focused); Chrome over macOS full-screen spaces; a real presentation clicker; the recording frame rate with it open on a quiet machine (the machine was heavily loaded, and the readings were meaningless).
- **Two unexplained readings** in an early run, with the window visible on a desktop in use: the speed fell 40→25, and the text went backwards for 5 s. Neither recurred in three later runs that logged every input event (only the test's own clicks and keys arrived). Outside input reaching the visible test window is the likely cause, not proven.
- **Fixed alongside:** the Stop all shortcut did nothing while the prompter's text had focus, because the prompter swallowed the key. It now ignores keys with Ctrl, ⌘ or Alt.

### Editor: what was measured and its limits

Chrome 156 on the Intel i7 Mac:

| Case | Result |
|---|---|
| Full export of a real 10-minute recording, with picture filter and a text overlay | 190 s (98 fps, about 3.3× real time). AVFoundation read video 620.50 s and audio 620.52 s, so QuickTime stays in sync. Peak memory of the whole browser 1.3 GB |
| Cut accuracy | Frames either side of each cut are the right ones to within 60 ms, including a cut starting inside a frame hold in the original |
| Sync across joins | Each flash-to-click offset matches the original's to within one frame (33 ms) |
| Noise removal, speech with steady noise | Noise between phrases −30.9 dB → silence; speech level within 0.5 dB |
| Volume −6 dB | Measured −6 ± 0.5 dB |

- **How small a cut can be:** sound is cut to the single audio sample (1/48,000 s, about 21 µs); the timeline zooms to 5 ms across, where samples show. The picture changes only between frames, every 33 ms, so a cut shorter than a frame removes sound but no picture. Each hard cut fades the sound over 3 ms either side so it doesn't click.
- **Smooth joins** crossfade only where at least 1 s was cut. Smaller cuts, and removed silences, stay hard joins, or a 0.5 s crossfade would run into the speech either side.
- **Finding silences** runs on its own as you edit: it measures 10 ms windows against a threshold suggested from the recording (halfway between its quiet and loud parts, clamped to −55…−25 dBFS). Over loud background noise it may find little; lower the threshold, or remove the noise first.
- **The timeline shows the video and its sound as separate rows.** Gaps found in the sound are yellow; hover one and click to delete it (one undo brings it back). On a touch screen, tap once to see it and again to delete it. A press that moves at all is a selection, not a delete, and clicks on the ruler or the video row only move the playhead.
- **Removed parts close up on the timeline**, leaving a red seam: click it to see what went and put it back. **Show removed** draws them at full length again, hatched, for adjusting a cut's edges. The ruler keeps the recording's own time, so its labels jump at a seam.
- **Shortening a gap:** drag either end of a yellow gap inwards; only the part dragged over is removed, so the rest stays as a pause. A gap narrower than about 24 px on screen has no ends to drag (zoom in), but can still be clicked away.
- **Scrolling while playing:** scrolling or zooming away from the playhead leaves the view where you put it; it follows the playhead again once the playhead is back in view. Zoomed in, a scrollbar under the timeline jumps anywhere.
- **Delete sound** leaves silence and **Delete picture** leaves black, both without changing the length; **Remove** takes out both. A picture cut stays black whatever the brightness or contrast. Overlays are still drawn over it.
- **Muting the sound row** switches off all of the recording's sound; the row stays, greyed. **Dragging the strip at the top of the sound row** shifts the sound against the picture (±2 s, in one undo step). Sound cuts stay where they are on the picture, so shift first, then cut.
- **Thumbnails** are made after the sound is read, one every 0.5 s (at most 1,200), and pause while an export runs. In the preview, the black of a picture cut can start or end up to a frame late; the export is exact.
- **Added audio** is decoded by the browser (MP3, WAV, M4A/AAC, OGG/Opus, FLAC in Chrome), at the recording's sample rate. All the added audio together is limited to about 35 minutes (400 MB decoded) to keep memory in check. Its files are kept with the recording, and deleted with it.
- **Music dipping while someone speaks** follows the recording's sound (after cuts, its shift and mutes) and any added track marked as a voice. "Speaking" is set from each recording (halfway between its quiet and loud levels), so steady background noise isn't taken for speech; with no real difference between the two, nothing dips. It goes down in about 50 ms and comes back over about 400 ms; those times are fixed. Measured over noise at −31 dB: music at −17.4 dB during speech, −8.9 dB in a pause, with a −12 dB setting.
- **Shifting the recording's sound** (−2 to +2 s) moves every click against its flash by the shift, measured to within a frame.
- **Output runs at a steady 30 fps.** Each output frame shows the original frame on screen at that moment, so frame holds in the original are kept, not squeezed out.
- **The preview's picture jumps at cuts** and may hold a frame there. Its sound is the exact edit, including fades, mutes, volume and noise removal. A smooth join's picture blend can only be seen by rendering it: Cuts → **Preview join** renders that join exactly.
- **With noise removal on, the preview's sound is about 33 ms behind its picture** (the live model's delay). The export takes that delay back out, measured at exactly 960 samples.
- **Noise removal can thin a voice.** It's off by default; listen before exporting, and lower the strength if needed. It needs 48 kHz audio (Bernou's recordings are), and says so otherwise.
- **The export worker is 5.4 MB, mostly the speech model.** It loads only when the editor opens, never in the studio, dashboard or audience window (`privacy.bundle.spec`).
- **Safari:** untested. Playwright's WebKit reports the encoders, but its import of slides fails (see Test environment note), so it couldn't be exercised end to end.

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

E2E was run on Playwright's Chromium and on system Chrome (`PW_CHROME_CHANNEL=chrome`). Firefox was run: its `@nomedia` specs passed and its media specs are skipped by design. **WebKit (Playwright's 27.2) was run for the prompter specs only:** the floating panel's 13 tests pass, but **PDF and image import fail there** (the slide counter never fills), so its 2 slide-control tests and 10 import tests fail. Safari import is therefore untested and possibly broken. Machine load affects the timing-sensitive specs, so don't run other heavy work beside them.

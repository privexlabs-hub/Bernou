# Known limitations and incomplete functionality

Maintained per the spec (§14): nothing is marked complete unless implemented and tested. Updated at the end of every development step.

## Status after Stage SECOND (MVP milestone, steps 2.1–2.10)

### Acceptance criteria (spec §14)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| AC1 | Create a presentation session | ✅ | `session.create.spec`, `dashboard.test.tsx`, `sessions.repo.test.ts` |
| AC2 | Import and navigate slides | ✅ (PDF, images) / ⚠️ PPTX via PDF export | `pdf.import.spec`, `pdfImporter.test.ts` |
| AC3 | Paste and edit a speech | ✅ | `script.notes.spec` (10,800-word paste, 400 sections), `scriptStore.test.ts` |
| AC4 | Control teleprompter scrolling | ✅ | `teleprompter.spec` ×3, `scrollModel.test.ts` |
| AC5 | Activate webcam | ✅ | `media.spec` (fake device, frames verified in both previews) |
| AC6 | Select microphone | ✅ | `media.spec` (device list, level meter rises, mute) |
| AC7 | Move and resize overlay | ✅ | `media.spec` (drag, corner resize, clamping, shape) |
| AC8 | Preview updates immediately | ✅ | `media.spec` (pixel hash changes < 500 ms, ≤ 2 frames) |
| AC9 | Audience window shows the correct composition | ✅ | `audience.window.spec` (pixel-equal to preview) |
| AC10 | Scripts never in audience output | ✅ | P1 (fuzz), P2 (channel canary), P3 (DOM), P4 (pixels), P6, P7 |
| AC11 | Notes never in audience output | ✅ | same suite |
| AC12 | Recording controls never in audience output | ✅ | P3 DOM audit (no buttons/inputs) + P7 bundle audit; recording itself is Stage THIRD |
| AC13 | Private changes don't change the audience output | ✅ | P4 differential pixel test + P5 positive controls |
| AC14 | Audience output selectable for conferencing | ✅ automated part (separate OS window, stable title "Bernou — Audience", capture handle) · ⏳ **manual QA matrix (Zoom/Meet/Teams on Windows/macOS) not yet run** |

### Feature status

| Area | Status | Notes |
|---|---|---|
| Privacy boundary | ✅ | 4 layers: closed type, strict Zod schema, dependency-cruiser rules + meta-test, bundle audit; privacy suite P1–P9 |
| Dashboard, sessions, persistence | ✅ | IndexedDB (Dexie). No network anywhere. |
| PDF import | ✅ | PDF.js 4.x, pages rasterised to PNG, thumbnails. Notes-pages heuristic warns (P8). |
| Image import | ✅ | PNG/JPEG/WebP, one slide per image |
| PPTX import | ⚠️ | **Refused with guidance** to export to PDF. No faithful in-browser renderer exists; Stage FOURTH. |
| Composition engine | ✅ | Slide (letterbox), camera (circle/rect, cover-fit, mirror, border, shadow, opacity), branding title; golden + determinism tests |
| Audience preview | ✅ | Same engine at real output resolution, CSS-scaled |
| Camera / microphone | ✅ | Selection, labels after grant, `devicechange`, error guidance, level meter, mute via gain, never routed to speakers |
| Overlay interaction | ✅ | Drag, corner resize, keyboard nudge, double-click shape toggle, corner presets; clamped in the protocol |
| Script editor | ✅ | Paste, sections, split at blank lines, reorder, delete, slide links, autosave |
| Speaker notes | ✅ | Per slide, autosave, shows linked script sections |
| Teleprompter | ✅ | Time-based scroll model; start/pause/resume/stop/reset; speed/font/colours/alignment/reading line & zone/mirror; manual wheel+keys; progress + time remaining; follow-slides |
| Audience window | ✅ | Separate Vite entry; BroadcastChannel; camera re-acquired by deviceId (video only); fullscreen; resync after reload; blank on stop |
| Emergency stop & indicators | ✅ | Ends every track, blanks audience, indicators from `track.readyState` (P9) |
| Branding title/logo | ⚠️ | Engine supports it; **no UI yet** to set the audience-visible title (planned with Stage THIRD polish). Logo assets not wired. |
| Panel collapse/resize | ✅ | `react-resizable-panels`, sizes persisted in localStorage |
| Recording, export, compression | ⏳ | Stage THIRD |
| Browser-content capture | ⏳ | Stage FOURTH — always needs the browser's own picker |
| Voice-following teleprompter | ⏳ | Stage FOURTH — opt-in, on-device only |
| Native virtual camera | ❌ | Not possible in a browser. Stage FOURTH desktop build. Interim: OBS Virtual Camera with the audience window as a source. |
| MP4 recording in Firefox | ❌ | Firefox has no MP4 muxer (Mozilla bug 1631143). WebM will be offered, labelled honestly. |

### Browser limitations that affect the MVP

- **Popup blockers**: the audience window is opened with `window.open` from a click; if blocked, the UI says so. It cannot be opened without a user gesture.
- **Background throttling**: a minimised audience window may be throttled by the OS/browser. The scheduler falls back to a Worker tick when `document.hidden`, but OS-level occlusion is outside our control. Guidance: keep the window un-minimised while sharing.
- **Two camera consumers**: the audience window re-opens the camera. Most drivers allow this; some Windows USB drivers do not (`NotReadableError`). The fallback (single renderer streamed over a same-origin WebRTC loopback) is designed but **not implemented** — needs hardware QA first.
- **Storage eviction**: Safari may evict script-written storage after 7 days without interaction. Recordings (Stage THIRD) must be exported promptly.
- **Firefox/WebKit E2E**: the fake-media suites are Chromium-only (`--use-file-for-fake-video-capture`). `@nomedia` specs run in all three projects in CI; media specs are skipped elsewhere.

### Test environment note

Playwright's own browser bundles could not be downloaded in the build sandbox (CDN not allow-listed), so E2E runs used the system Chrome via `PW_CHROME_CHANNEL=chrome`. CI installs Playwright's Chromium and Firefox normally. **Firefox and WebKit E2E have not been executed yet** in this environment.

# Bernou

A private presentation, teleprompter, recording and live-meeting studio for academics, lecturers, consultants, educators and remote teams.

**One private presenter workspace. One independently rendered audience output.**

The audience output is never a screen capture of the app. It is drawn by a standalone Canvas engine that receives only a strictly typed, allow-listed payload. Scripts, teleprompter text, speaker notes, recording controls and device settings cannot reach it — enforced by types, a strict runtime schema, build-time import rules, and automated pixel tests. See [docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md).

## Status

Stage SECOND (MVP) is implemented and tested. Recording (Stage THIRD) and advanced integration (Stage FOURTH) are not started. See [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for the honest per-feature status.

## Run it

```bash
pnpm install
pnpm dev            # presenter workspace at http://localhost:5173
```

Open the app, create a presentation, import a PDF (export PowerPoint to PDF first), paste a script, turn on your camera and microphone, then **Open audience window** and share *that window* in Zoom, Meet or Teams.

## Verify it

```bash
pnpm check          # typecheck · privacy boundary · boundary meta-test · unit + privacy tests · build · bundle audit
pnpm test:e2e       # Playwright with fake camera/microphone (Chromium, Firefox; WebKit runs @nomedia specs)
```

If Playwright's browsers can't be downloaded, run the E2E suite against a system Chrome: `PW_CHROME_CHANNEL=chrome pnpm test:e2e -- --project=chromium`.

## Layout

```
packages/audience-protocol    the privacy boundary: AudiencePayload, strict schema, validated channel
packages/composition-engine   framework-free Canvas renderer (preview, recorder, audience window)
packages/media-core           devices, audio graph (never routed to speakers), level meter
packages/import-core          PDF / image importers → rasterised slides; PPTX guidance
packages/platform             browser ⇄ Tauri adapter interface (Stage FOURTH)
apps/web                      React presenter workspace (index.html) + audience-only page (audience.html)
fixtures/                     deterministic PDFs, fake camera/mic media, golden images
docs/                         architecture, privacy model, limitations
```

Everything stays on the device. There is no network sync.

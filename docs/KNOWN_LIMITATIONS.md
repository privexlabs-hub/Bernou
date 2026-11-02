# Known limitations and incomplete functionality

Maintained per the spec (§14): nothing is marked complete unless implemented and tested. Updated at the end of every development step.

## Status after step 2.1 (scaffold + privacy boundary)

| Area | Status |
|---|---|
| Privacy boundary (`audience-protocol`, dependency rules, meta-test, bundle audit) | ✅ Implemented and tested |
| Dashboard | ⏳ Route placeholder only — step 2.2 |
| Sessions / persistence | ⏳ Step 2.2 |
| PDF import, navigation | ⏳ Step 2.3 |
| Composition engine, preview | ⏳ Step 2.4 |
| Camera / microphone | ⏳ Step 2.5 |
| Overlay drag / resize | ⏳ Step 2.6 |
| Script editor, notes | ⏳ Step 2.7 |
| Teleprompter | ⏳ Step 2.8 |
| Audience window | ⏳ Channel + neutral frame only — step 2.9 |
| Emergency stop, indicators | ⏳ Step 2.10 |
| Recording, export | ⏳ Stage THIRD |
| PPTX import | ⏳ Stage FOURTH — MVP guides users to export to PDF |
| Browser-content capture | ⏳ Stage FOURTH — always needs the browser's own picker |
| Voice-following teleprompter | ⏳ Stage FOURTH — opt-in, on-device only |
| Native virtual camera | ❌ Not possible in a browser. Stage FOURTH desktop build. |
| MP4 recording in Firefox | ❌ Firefox has no MP4 muxer (Mozilla bug 1631143). WebM will be offered, honestly labelled. |

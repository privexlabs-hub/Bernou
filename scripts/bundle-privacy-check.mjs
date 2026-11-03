#!/usr/bin/env node
/**
 * Privacy test P7 — bundle content audit.
 *
 * After `vite build`, the audience entry must produce chunks that contain NO
 * private module identifiers and NO React runtime. If any forbidden token is
 * found in a chunk the audience page loads, this exits non-zero.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const dist = resolve(root, "apps/web/dist");
const assets = resolve(dist, "assets");

const FORBIDDEN = [
  "useScriptStore",
  "useNotesStore",
  "useTeleprompterStore",
  "useRecordingStore",
  "useMicStore",
  "stores/private",
  "scriptStore",
  "notesStore",
  "teleprompterStore",
  "recordingStore",
  "react-dom",
  "__reactFiber",
  "createRoot(",
  "dexie",
  "Dexie",
  "MediaRecorder",
  "captureStream",
  "requestFrame",
  "createSyncAccessHandle",
];

// Which chunks does audience.html actually load?
const audienceHtml = readFileSync(resolve(dist, "audience.html"), "utf8");
const loaded = [...audienceHtml.matchAll(/\/assets\/([^"' ]+\.js)/g)].map((m) => m[1]);
if (loaded.length === 0) {
  console.error("✗ audience.html references no JS chunks — build layout changed?");
  process.exit(1);
}

// Also follow static imports from those chunks (Vite emits relative imports).
const seen = new Set();
const queue = [...loaded];
while (queue.length) {
  const f = queue.shift();
  if (!f || seen.has(f)) continue;
  seen.add(f);
  const src = readFileSync(resolve(assets, f), "utf8");
  for (const m of src.matchAll(/from"\.\/([^"]+\.js)"/g)) queue.push(m[1]);
  for (const m of src.matchAll(/import"\.\/([^"]+\.js)"/g)) queue.push(m[1]);
}

let failed = false;
for (const f of seen) {
  const src = readFileSync(resolve(assets, f), "utf8");
  for (const token of FORBIDDEN) {
    if (src.includes(token)) {
      console.error(`✗ ${f} contains forbidden token "${token}"`);
      failed = true;
    }
  }
}

const all = readdirSync(assets).filter((f) => f.endsWith(".js"));
console.log(`Audience page loads ${seen.size} chunk(s): ${[...seen].join(", ")} (of ${all.length} total)`);
if (failed) process.exit(1);
console.log("✓ No private identifiers or React runtime in audience chunks.");

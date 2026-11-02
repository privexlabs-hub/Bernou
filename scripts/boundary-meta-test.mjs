#!/usr/bin/env node
/**
 * Boundary meta-test (privacy test P6).
 *
 * Proves that the dependency-cruiser privacy rules actually bite:
 *  1. Runs the boundary check on the real tree → must PASS.
 *  2. Writes a temporary file under apps/web/src/audience/ that imports the
 *     private script store → boundary check must FAIL.
 *  3. Removes the temporary file (always, even on error).
 *
 * If step 2 passes, the privacy wall is broken and this script exits non-zero.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const canaryFile = resolve(root, "apps/web/src/audience/__boundary_canary__.ts");

function runBoundary() {
  const r = spawnSync("npx", ["depcruise", "--config", ".dependency-cruiser.cjs", "packages", "apps/web/src"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

let exitCode = 0;
try {
  const clean = runBoundary();
  if (!clean.ok) {
    console.error("✗ Boundary check FAILED on the clean tree. Fix the violations below before continuing.\n");
    console.error(clean.out);
    process.exit(1);
  }
  console.log("✓ Clean tree passes the boundary rules.");

  writeFileSync(
    canaryFile,
    `// TEMPORARY FILE WRITTEN BY scripts/boundary-meta-test.mjs — if you see this committed, delete it.
import { useScriptStore } from "../stores/private/scriptStore";
export const leak = useScriptStore;
`,
  );
  const dirty = runBoundary();
  if (dirty.ok) {
    console.error("✗ META-TEST FAILED: a forbidden import from the audience window into stores/private was NOT rejected.");
    console.error("  The privacy boundary rules are not enforcing anything. Fix .dependency-cruiser.cjs.");
    exitCode = 1;
  } else {
    console.log("✓ Forbidden import was rejected as expected. Privacy boundary is enforced.");
  }
} finally {
  if (existsSync(canaryFile)) rmSync(canaryFile);
}
process.exit(exitCode);

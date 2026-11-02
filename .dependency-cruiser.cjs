/**
 * Bernou privacy boundary — static import rules.
 *
 * The audience renderer (apps/web/src/audience/**), the composition engine and
 * the audience protocol must never be able to reach private presenter state.
 * If any rule here fails, CI fails. See docs/PRIVACY_MODEL.md.
 *
 * Verified by scripts/boundary-meta-test.mjs, which deliberately injects a
 * forbidden import and asserts that this configuration rejects it.
 */

const PRIVATE_SOURCES = [
  "^apps/web/src/stores/private",
  "^apps/web/src/features/(script|notes|teleprompter|recording|media|dashboard|session|slides|safety|voiceFollow|capture)",
  "^apps/web/src/db",
  "^packages/media-core/src/recorder",
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "audience-window-must-not-import-private-code",
      severity: "error",
      comment:
        "The audience-only entry (audience.html → src/audience/**) must never import scripts, notes, teleprompter, recording, device UI, stores/private, or the database.",
      from: { path: "^apps/web/src/audience" },
      to: { path: PRIVATE_SOURCES },
    },
    {
      name: "audience-window-must-not-import-any-store",
      severity: "error",
      comment:
        "The audience window receives data ONLY through the audience-protocol channel. It has no Zustand stores at all, public or private.",
      from: { path: "^apps/web/src/audience" },
      to: { path: ["^apps/web/src/stores", "^apps/web/src/features", "^apps/web/src/app"] },
    },
    {
      name: "composition-engine-must-be-pure",
      severity: "error",
      comment:
        "The composition engine is a framework-free package. It may import only the audience-protocol package and its own files.",
      from: { path: "^packages/composition-engine" },
      to: {
        path: "^(apps|packages)/",
        pathNot: ["^packages/composition-engine", "^packages/audience-protocol"],
      },
    },
    {
      name: "audience-protocol-must-have-no-app-deps",
      severity: "error",
      comment: "The protocol package is the boundary. It depends on nothing inside the repo.",
      from: { path: "^packages/audience-protocol" },
      to: { path: "^(apps|packages)/", pathNot: "^packages/audience-protocol" },
    },
    {
      name: "only-audience-bridge-builds-payload",
      severity: "error",
      comment:
        "buildAudiencePayload lives in stores/audienceBridge.ts. Nothing else in the presenter app may construct a payload by importing the schema's constructor helpers directly.",
      from: {
        path: "^apps/web/src",
        pathNot: ["^apps/web/src/stores/audienceBridge\\.ts$", "^apps/web/src/audience", "^apps/web/src/features/preview", "^apps/web/src/features/audienceWindow"],
      },
      to: { path: "^packages/audience-protocol/src/build\\.ts$" },
    },
    {
      name: "audience-code-no-unresolvable-imports",
      severity: "error",
      comment:
        "An import that cannot be resolved is classified as 'unknown' and would otherwise slip past the path rules above. Audience and engine code must only import things that exist and resolve.",
      from: { path: ["^apps/web/src/audience", "^packages/composition-engine", "^packages/audience-protocol"] },
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["node_modules", "\\.test\\.", "\\.spec\\.", "/test/", "/tests/", "/dist/"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};

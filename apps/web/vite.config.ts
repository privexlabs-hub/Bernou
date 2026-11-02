import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Multi-page build:
 *   index.html     → private presenter workspace (React app)
 *   audience.html  → audience-only renderer (NO React, NO stores — see src/audience/main.ts)
 *
 * The two entries produce separate chunks. Privacy test P7 greps the built
 * audience chunks for private module identifiers.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        presenter: fileURLToPath(new URL("./index.html", import.meta.url)),
        audience: fileURLToPath(new URL("./audience.html", import.meta.url)),
      },
      output: {
        // The side-effect-free library packages shared by both pages go in one
        // auditable chunk. The audience ENTRY (src/audience/**) must NOT be
        // merged into it: a chunk's top-level code runs whenever any page loads
        // that chunk, so merging would execute the audience bootstrap inside
        // the presenter page.
        manualChunks(id) {
          if (id.includes("/packages/composition-engine/") || id.includes("/packages/audience-protocol/")) return "audience-core";
          return undefined;
        },
      },
    },
  },
  worker: { format: "es" },
  optimizeDeps: { include: ["pdfjs-dist"] },
  server: { port: 5173, strictPort: true },
});

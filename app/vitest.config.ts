import { defineConfig } from "vitest/config";

// Unit tests of the pure logic of the frontend (`*.test.ts` next to the code). Tests run in
// Node; files that need `localStorage` or `window` opt into jsdom with
// `// @vitest-environment jsdom`.
export default defineConfig({
  // three-bvh-csg only declares its ES module build in "module": bundle it like the app does,
  // instead of loading its UMD build, which requires the deprecated CommonJS build of three.js
  ssr: { resolve: { mainFields: ["module", "main"] } },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testSetup.ts"],
    server: { deps: { inline: ["three-bvh-csg"] } },
  },
});

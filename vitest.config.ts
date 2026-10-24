import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{voice,shared,convex,components,lib,actor/src}/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [["convex/**", "edge-runtime"]],
    server: { deps: { inline: ["convex-test"] } },
  },
});

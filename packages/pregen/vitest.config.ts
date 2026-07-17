import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Daily generation walks real seed sequences with testPossible.
    testTimeout: 120_000,
  },
});

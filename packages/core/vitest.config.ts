import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The bulk-diff and difficulty suites generate hundreds of islands.
    testTimeout: 120_000,
  },
});

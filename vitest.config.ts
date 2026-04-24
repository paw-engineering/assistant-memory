import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "test/**/*.test.ts", "src/test/**/*.test.ts"],
    environment: "node",
    pool: "vmForks",
    run: {
      reporter: ["verbose"],
    },
  },
});
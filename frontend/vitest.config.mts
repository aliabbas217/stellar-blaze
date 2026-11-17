import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts", "./tests/setup-msw.ts"],
    // Above the 5 s asyncUtilTimeout of tests/setup.ts, so a wait that never settles fails with its own message.
    testTimeout: 15_000,
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});

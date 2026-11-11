import { defineConfig, devices } from "@playwright/test";

/*
 * Minimal on purpose: enough to run tests/e2e against a server that is already up (`pnpm build && pnpm start`,
 * with API_ORIGIN pointing at `pnpm mock:api`). Task 12 adds the webServer, the CI reporters and the other projects.
 */
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:3000" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

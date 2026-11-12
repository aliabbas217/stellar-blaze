import { createECDH } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/*
 * End-to-end tests run against the production build, served the way the container serves it (scripts/start-standalone.mjs),
 * with the API replaced by the mock one (`pnpm mock:api`). Build first: `pnpm build && pnpm e2e`. CI does.
 *
 * What the web server gets here is wiring only, read at request time (ADR 0009/0010): no tunable value lives in this file.
 */

const MOCK_API_PORT = 4010; // scripts/mock-api.ts
const WEB_PORT = 3000;
const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;

/*
 * A valid VAPID application server key (an uncompressed P-256 public key, base64url) for the Alerts page, which decodes
 * it before it calls the stubbed subscribe. It is generated on each run and its private half is discarded: nothing can
 * sign a push for it, and there is no key in the repository to keep, rotate or mistake for a real one.
 */
function testVapidPublicKey(): string {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  return keys.getPublicKey("base64url");
}

export default defineConfig({
  testDir: "tests/e2e",
  // Visual baselines are Linux-rendered and only valid inside the pinned Playwright container, so `pnpm e2e` never runs them.
  testIgnore: "**/visual.spec.ts",
  forbidOnly: !!process.env.CI,
  /*
   * One worker: the service-worker push tests (alerts.spec.ts) read the browser's notifications, and on a Windows host
   * every browser shares the system notification centre, which replaces a notification by origin and tag across
   * browsers. Two workers, which means two projects at once, can make each other's notifications vanish. The suite is
   * small, and a serial run is stable.
   */
  workers: 1,
  // `open: "never"`: the HTML reporter's default is to serve the report and wait when a test failed.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    // The default headless build (chromium-headless-shell) answers "denied" to every notification permission, whatever
    // grantPermissions says, so the push tests need the full Chromium (ruling R30). One browser for every spec keeps
    // the two projects comparable.
    channel: "chromium",
  },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      name: "mock API",
      command: "pnpm mock:api",
      url: `http://127.0.0.1:${String(MOCK_API_PORT)}/api/v1/sites`,
      // Never test against a server that was already there: a stale build, or `next dev`, would pass or fail for the wrong reason.
      reuseExistingServer: false,
    },
    {
      name: "web",
      command: "pnpm start:standalone",
      url: `${WEB_ORIGIN}/api/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(WEB_PORT),
        // The standalone server binds to $HOSTNAME, which a shell may have set to the machine's name.
        HOSTNAME: "127.0.0.1",
        API_ORIGIN: `http://127.0.0.1:${String(MOCK_API_PORT)}`,
        VAPID_PUBLIC_KEY: testVapidPublicKey(),
        // Without it a production build ignores the `x-sb-mock-scenario` header that the specs use to make the API fail on purpose.
        SB_MOCK_SCENARIOS: "1",
      },
    },
  ],
});

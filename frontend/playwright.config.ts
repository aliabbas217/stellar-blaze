import { createECDH } from "node:crypto";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import { isLive, liveApiOrigin, liveEmployerToken } from "./tests/e2e/live/env";

/*
 * End-to-end tests run against the production build, served the way the container serves it (scripts/start-standalone.mjs),
 * with the API replaced by the mock one (`pnpm mock:api`). Build first: `pnpm build && pnpm e2e`. CI does.
 *
 * What the web server gets here is wiring only, read at request time (ADR 0009/0010): no tunable value lives in this file.
 *
 * Two modes. The default is the mock projects above (MSW is the backend, the one e2e and dev use). With E2E_LIVE=1
 * (`pnpm e2e:live`) the only project is `live`: tests/e2e/live/*.spec.ts against a REAL B3 backend at E2E_API_ORIGIN, which
 * this config never starts. The mode is chosen by the environment, not by a flag on the command line, because a project that
 * is always defined would run in a plain `pnpm e2e` and fail there with no backend. See README, "Running F2 against the real B3".
 */

const MOCK_API_PORT = 4010; // scripts/mock-api.ts
const WEB_PORT = 3000;
const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;

const LIVE = isLive(process.env);
const LIVE_ORIGIN = LIVE ? liveApiOrigin(process.env) : null;
const LIVE_TOKEN = LIVE ? liveEmployerToken(process.env) : null;

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
  projects: LIVE
    ? [{ name: "live", testMatch: "live/**/*.spec.ts", use: { ...devices["Pixel 7"] } }]
    : [
        { name: "mobile-chromium", testIgnore: ["**/visual.spec.ts", "**/live/**"], use: { ...devices["Pixel 7"] } },
        { name: "desktop-chromium", testIgnore: ["**/visual.spec.ts", "**/live/**"], use: { ...devices["Desktop Chrome"] } },
      ],
  webServer: LIVE ? liveWebServer() : mockWebServers(),
});

/**
 * The live stack: only the web server, wired to the operator's backend. With no E2E_API_ORIGIN there is nothing to wire it to,
 * so no server starts and the live specs skip themselves with a message. The mock-only switches are NOT set: no
 * `x-sb-mock-scenario` header is forwarded to a real API, and the BFF keeps its real write limits.
 */
function liveWebServer(): NonNullable<PlaywrightTestConfig["webServer"]> {
  if (LIVE_ORIGIN === null) return [];
  return [
    {
      name: "web (live)",
      command: "pnpm start:standalone",
      url: `${WEB_ORIGIN}/api/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(WEB_PORT),
        HOSTNAME: "127.0.0.1",
        API_ORIGIN: LIVE_ORIGIN,
        VAPID_PUBLIC_KEY: testVapidPublicKey(),
        // Explicitly off, whatever the operator's shell holds: a real API must never be sent the mock scenario header.
        SB_MOCK_SCENARIOS: "0",
        // The token is the operator's, passed through to the web server's environment only; it is never written or printed here.
        ...(LIVE_TOKEN === null ? {} : { DEMO_EMPLOYER_TOKEN: LIVE_TOKEN }),
      },
    },
  ];
}

function mockWebServers(): NonNullable<PlaywrightTestConfig["webServer"]> {
  return [
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
        // The dev pages (the specimen, the component kit) answer 404 in a production build without it; kit.spec.ts needs the kit.
        SB_SPECIMEN: "1",
        // The BFF's demo employer token (F2 decision D4) and the write rate limits that guard it. The token is a test value
        // that opens only the mock API; the limits are far above anything a spec does, so a rate limit never fails an
        // unrelated test (the limiter itself is covered by tests/unit/api/rate-limit.test.ts).
        DEMO_EMPLOYER_TOKEN: "e2e-demo-employer-token",
        DEMO_WRITE_RATE_PER_MIN: "10000",
        DEMO_WRITE_GLOBAL_RATE_PER_MIN: "10000",
        // The BFF's two upstream time limits (src/lib/upstream-timeouts.ts). Reads get 15 s, as a deployment that waits out a cold
        // start would; Stop work and its undo get 3 s, so slow-api.spec.ts can show a Stop cut at its own limit well before the
        // phone's own 8 s. A mock request is answered in milliseconds, so no other spec is near either.
        UPSTREAM_READ_TIMEOUT_MS: "15000",
        UPSTREAM_TIMEOUT_MS: "3000",
      },
    },
  ];
}

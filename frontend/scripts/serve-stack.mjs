// Serves the production build against the mock API, from one process, for a tool that takes a single "start the
// server" command (Lighthouse CI: lighthouserc.json). Playwright starts the same two servers itself, as the two
// entries of `webServer` in playwright.config.ts, and keeps the wiring below in step with it.
//
// It deliberately leaves out SB_MOCK_SCENARIOS, which playwright.config.ts sets: that variable makes a production
// build forward the `x-sb-mock-scenario` header that fails the API on purpose, and Lighthouse should measure the
// behaviour users get, with no such hook in the server.
//
// One process, so that stopping it stops both servers on every platform (a shell-spawned pnpm leaves its children running on Windows).
// Usage: pnpm build && node scripts/serve-stack.mjs
import { createECDH } from "node:crypto";

// A valid VAPID application server key for the Alerts page. Generated on each start; its private half is discarded.
const vapid = createECDH("prime256v1");
vapid.generateKeys();

Object.assign(process.env, {
  PORT: "3000",
  // The standalone server binds to $HOSTNAME, which a shell may have set to the machine's name.
  HOSTNAME: "127.0.0.1",
  API_ORIGIN: "http://127.0.0.1:4010", // the port scripts/mock-api.ts listens on
  VAPID_PUBLIC_KEY: vapid.getPublicKey("base64url"),
  // Same as playwright.config.ts: the demo employer token (a test value for the mock API) and generous write limits.
  DEMO_EMPLOYER_TOKEN: "e2e-demo-employer-token",
  DEMO_WRITE_RATE_PER_MIN: "10000",
  DEMO_WRITE_GLOBAL_RATE_PER_MIN: "10000",
});

// Each module starts its server when it is imported. Node strips the types of mock-api.ts.
await import("./mock-api.ts");
await import("./start-standalone.mjs");

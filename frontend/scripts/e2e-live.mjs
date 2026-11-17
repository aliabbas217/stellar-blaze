// `pnpm e2e:live`: runs the live Playwright project (tests/e2e/live) against a REAL B3 backend (replay mode).
// It never starts the backend. E2E_LIVE=1 is what selects the live project in playwright.config.ts; it is set here, not in the
// package.json script, because `VAR=1 command` is not portable to every shell pnpm may use on Windows.
// Usage (from frontend/, after `pnpm build`): E2E_API_ORIGIN=http://127.0.0.1:8000 E2E_DEMO_EMPLOYER_TOKEN=... pnpm e2e:live
// See README, "Running F2 against the real B3". Extra arguments go to `playwright test`, for example `pnpm e2e:live -g Today`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { LIVE_SKIP_MESSAGE } from "../tests/e2e/live/env.ts";

if ((process.env.E2E_API_ORIGIN ?? "").trim() === "") {
  // The specs skip themselves too (and the report says so); this line is for the person watching the terminal.
  console.warn(LIVE_SKIP_MESSAGE);
}

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const child = spawn(process.execPath, [cli, "test", "--project=live", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, E2E_LIVE: "1" },
});
child.on("exit", (code) => {
  process.exit(code ?? 1);
});

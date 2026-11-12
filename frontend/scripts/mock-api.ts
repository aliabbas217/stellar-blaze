// The standalone mock API: the MSW handlers behind a real HTTP port, for e2e (Playwright's webServer) and for
// `curl 127.0.0.1:4010/api/v1/sites`. Run with `pnpm mock:api`; stop it with Ctrl+C.
// Node strips the types of this file, so every import here, and in the modules it reaches, ends in ".ts".
import { createServer } from "@msw/serve";
import { handlers } from "../src/mocks/handlers.ts";

const PORT = 4010;
// The loopback address, not every interface: it serves synthetic data without authentication, and every caller
// (Playwright, Lighthouse CI through scripts/serve-stack.mjs, the web server's API_ORIGIN) uses 127.0.0.1.
const HOST = "127.0.0.1";

createServer(...handlers).listen(PORT, HOST, () => {
  console.log(`mock API listening on http://${HOST}:${String(PORT)}`);
});

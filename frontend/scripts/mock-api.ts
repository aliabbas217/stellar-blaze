// The standalone mock API: the MSW handlers behind a real HTTP port, for e2e (Playwright's webServer) and for
// `curl localhost:4010/api/v1/sites`. Run with `pnpm mock:api`; stop it with Ctrl+C.
// Node strips the types of this file, so every import here, and in the modules it reaches, ends in ".ts".
import { createServer } from "@msw/serve";
import { handlers } from "../src/mocks/handlers.ts";

const PORT = 4010;

createServer(...handlers).listen(PORT, () => {
  console.log(`mock API listening on http://localhost:${String(PORT)}`);
});

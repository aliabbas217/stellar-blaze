import { setupServer } from "msw/node";
import { handlers } from "./handlers.ts";

/** The MSW server the Vitest setup file starts (tests/setup-msw.ts). Override a handler with `server.use(...)`. */
export const server = setupServer(...handlers);

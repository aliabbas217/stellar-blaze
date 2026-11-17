import { resolveUpstreamTimeouts } from "@/lib/upstream-timeouts";

/*
 * Next.js runs `register` once when the server starts, and takes no request until it returns
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md). It is the place that fails closed:
 * a bad UPSTREAM_TIMEOUT_MS or UPSTREAM_READ_TIMEOUT_MS throws here, with the variable, the value and the allowed range in the
 * message, so nothing is served under a limit nobody chose. Measured on the production build (Next 16.4.6): the throw does NOT
 * end the process. The standalone server stays up, logs "Failed to prepare server ... An error occurred while loading
 * instrumentation hook: <the message>", and answers 500 to every request: `/api/healthz`, `/api/v1/*` and the pages. A release
 * probe on `/api/healthz` therefore never passes for a revision with a bad value, and the previous revision keeps serving. There
 * is deliberately no `process.exit`. The BFF route parses the same variables again on first use
 * (src/app/api/v1/[...path]/route.ts) and answers a logged 502 where this did not run.
 */
export function register(): void {
  // The BFF runs on the Node.js runtime only; there is nothing to check on another one.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  resolveUpstreamTimeouts(process.env);
}

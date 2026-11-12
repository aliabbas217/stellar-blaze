// Starts the production build the way the Dockerfile's runtime stage does: the standalone server, with public/ and
// .next/static copied next to it (Next.js leaves both out of .next/standalone, expecting a CDN to serve them:
// https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
//
// Playwright's webServer and Lighthouse CI start the app through this script so that they test the artifact that ships.
// `next start` is not that artifact: Next.js warns that it does not work with `output: "standalone"`.
//
// Configuration is the server's own environment (PORT, HOSTNAME, API_ORIGIN, VAPID_PUBLIC_KEY, ...), read at request time.
// Usage: pnpm build && pnpm start:standalone
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const standalone = join(root, ".next", "standalone");
const server = join(standalone, "server.js");

if (!existsSync(server)) {
  console.error(`start:standalone: ${server} does not exist. Run "pnpm build" first.`);
  process.exit(1);
}

cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });

// server.js starts listening on import: it chdirs to its own folder and reads PORT and HOSTNAME.
await import(pathToFileURL(server).href);

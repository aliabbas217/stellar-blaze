import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Negotiates the locale and redirects `/` (and any path without a locale prefix) to `/<locale>/...`.
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, the service worker route, Next internals and files with an extension.
  matcher: "/((?!api|serwist|_next|_vercel|.*\\..*).*)",
};

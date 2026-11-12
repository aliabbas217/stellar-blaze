import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/*
 * Security headers of every response (plan F1 Task 13; tests/e2e/headers.spec.ts pins the exact values), except the
 * hashed build output under /_next/static/. A browser reads these headers from a document or a worker script; on a
 * script, stylesheet or font loaded by a page they do nothing, and the policy that governs them is the page's. Lighthouse
 * counts response headers in a script's transfer size, so the four headers (about 380 bytes) on each of Alerts' eleven
 * chunks took the 170 KB script budget from 172,562 to 176,784 bytes (budget 174,080); Next.js's own CSP guide
 * recommends leaving static assets out too. The standalone server applies `headers()` as well: `output: "standalone"`
 * carries it in its routes manifest.
 * https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
 *
 * The policy, directive by directive:
 *  - Everything is same-origin by default, and so is every request the page or the service worker makes
 *    (`connect-src 'self'`): the browser talks to the BFF at /api/v1/* and never to API_ORIGIN. That also keeps a
 *    cross-origin GET from reaching the service worker's runtime caching rule for /api/ (the worker's policy is the one
 *    on its script response, so these headers apply to /serwist/sw.js too).
 *  - Fonts are self-hosted by next/font, so `font-src 'self'`; `img-src` adds `data:` for inlined images.
 *  - `frame-ancestors 'none'`: the app is never embedded.
 *
 * `'unsafe-inline'` stays for scripts (Next.js's inline bootstrap and flight-data scripts, and the theme script in the
 * root layout) and for styles. The policy that would replace it for scripts uses a nonce, which Next.js applies only to
 * pages rendered per request (https://nextjs.org/docs/app/guides/content-security-policy#nonces), and that would end the
 * prerendering of the pages the service worker precaches. Parked, trigger: before any pilot (docs/parking-lot.md).
 *
 * Development only: React reads server stacks with `eval` in the browser, so `next dev` needs `'unsafe-eval'` for
 * scripts (same guide). A production build gets exactly the policy above.
 */
const development = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // The root layout sits under the dynamic [locale] segment, so Next.js answers an unmatched URL (/en/typo,
    // /file.txt) with its built-in 404 document, which has no lang or direction. global-not-found.tsx replaces it
    // with a server-rendered, localized one (documented for this setup by Next.js and by next-intl).
    // https://nextjs.org/docs/app/api-reference/file-conventions/not-found#global-not-foundjs-experimental
    globalNotFound: true,
  },
  headers() {
    return Promise.resolve([
      {
        source: "/:path((?!_next/static/).*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]);
  },
};

// Finds src/i18n/request.ts (the default location) and wires next-intl into the build.
const withNextIntl = createNextIntlPlugin();

// Keeps esbuild out of the server bundle: it builds the service worker (src/app/serwist/[path]/route.ts).
export default withSerwist(withNextIntl(nextConfig));

import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // The root layout sits under the dynamic [locale] segment, so Next.js answers an unmatched URL (/en/typo,
    // /file.txt) with its built-in 404 document, which has no lang or direction. global-not-found.tsx replaces it
    // with a server-rendered, localized one (documented for this setup by Next.js and by next-intl).
    // https://nextjs.org/docs/app/api-reference/file-conventions/not-found#global-not-foundjs-experimental
    globalNotFound: true,
  },
};

// Finds src/i18n/request.ts (the default location) and wires next-intl into the build.
const withNextIntl = createNextIntlPlugin();

// Keeps esbuild out of the server bundle: it builds the service worker (src/app/serwist/[path]/route.ts).
export default withSerwist(withNextIntl(nextConfig));

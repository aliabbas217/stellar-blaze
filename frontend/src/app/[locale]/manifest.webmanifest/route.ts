import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { manifestFor } from "@/features/pwa/manifest";
import { routing } from "@/i18n/routing";

/*
 * GET /<locale>/manifest.webmanifest: the web app manifest in that locale (see features/pwa/manifest.ts for why
 * it is per locale). It depends only on the locale and the messages, so it is built once per locale at build
 * time. `dynamicParams = false` makes Next.js answer 404 for any other first segment before this runs; the
 * hasLocale check is still here because it is what narrows the type, and a handler should not trust its router.
 */

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_request: Request, { params }: RouteContext<"/[locale]/manifest.webmanifest">): Promise<Response> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return new Response(null, { status: 404 });

  const t = await getTranslations({ locale, namespace: "common" });
  // The registered media type of a web app manifest; Next.js would otherwise serve it as text/plain.
  return new Response(JSON.stringify(manifestFor(locale, t)), {
    headers: { "content-type": "application/manifest+json" },
  });
}

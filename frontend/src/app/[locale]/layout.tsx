import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { fontClassFor } from "@/app/fonts";
import { titleTemplate } from "@/app/titles";
import { sunScript } from "@/components/shell/theme-script";
import { LocalePrefs } from "@/features/pwa/LocalePrefs";
import { APPLE_TOUCH_ICON, MANIFEST_COLORS } from "@/features/pwa/manifest";
import { dirFor } from "@/i18n/direction";
import { routing } from "@/i18n/routing";
import { QueryProvider } from "@/providers/QueryProvider";
import "@/styles/globals.css";

/*
 * The root layout of the app (there is no app/layout.tsx: next-intl and Next.js `root-params` need the
 * [locale] segment above the root layout). It owns <html>, so `lang` and `dir` are always set: tokens.css
 * keys letter-spacing on :lang(en) and globals.css keys the body font on :lang(en) and line height on :lang(ar)
 * and :lang(ur).
 */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Night is the default theme whatever the system prefers; on a field route in sun mode the inline script and the
// SunToggle move this meta to the sun colour (a static <meta> cannot follow data-theme).
export const viewport: Viewport = {
  themeColor: MANIFEST_COLORS.night,
};

export async function generateMetadata(props: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: { default: t("appName"), template: titleTemplate(t("appName")) },
    description: t("appDescription"),
    // One manifest per locale so the installed app opens on /<locale>/worker (features/pwa/manifest.ts).
    manifest: `/${locale}/manifest.webmanifest`,
    icons: { apple: [APPLE_TOUCH_ICON] },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    // suppressHydrationWarning: the inline sun script sets data-theme on <html> before React hydrates.
    <html lang={locale} dir={dirFor(locale)} className={fontClassFor(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sunScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* reloadOnOnline off: the default reloads the page whenever the connection returns, which would wipe a
            half-filled profile form on a patchy site connection; TanStack Query already refetches on reconnect. */}
        <SerwistProvider swUrl="/serwist/sw.js" reloadOnOnline={false}>
          <NextIntlClientProvider>
            {/* Leaves the language for the service worker, which shows push notifications with no page open. */}
            <LocalePrefs />
            <QueryProvider>{children}</QueryProvider>
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}

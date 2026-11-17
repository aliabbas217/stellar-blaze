import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata } from "next";
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
        {/* Night is the default browser-chrome colour whatever the system prefers; the inline script, ScreenColors and
            useRouteTheme move it to the sun colour on a field route in sun mode. It is a plain <meta> here and not
            `viewport.themeColor`: Next re-renders that one on every client navigation and puts the night colour back
            after the theme was applied (the sun colour was lost on a navigation from the landing page to /worker). Next
            still writes the default viewport meta. */}
        <meta name="theme-color" content={MANIFEST_COLORS.night} />
        <script dangerouslySetInnerHTML={{ __html: sunScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* reloadOnOnline off: the default reloads the page whenever the connection returns, which would wipe a
            half-filled profile form on a patchy site connection; TanStack Query already refetches on reconnect. */}
        <SerwistProvider swUrl="/serwist/sw.js" reloadOnOnline={false}>
          <NextIntlClientProvider messages={{}}>
            {/* No messages here on purpose: each route group wraps its children in `ClientMessages` (src/i18n/ClientMessages.tsx) with
                the namespaces its client components read. The provider with no `messages` prop put the whole catalogue (16 KB gzip) in
                the flight payload of every page. */}
            {/* Leaves the language for the service worker, which shows push notifications with no page open. */}
            <LocalePrefs />
            {/* Sun mode is reset to night by the field shell when it unmounts (FieldShell.tsx), not by a guard here: a guard
                at the root shipped its code to every route, the landing page included. */}
            {/* No QueryProvider here on purpose (F2 Task 3): TanStack Query is mounted only in the worker and supervisor
                layouts and the judge (live) sub-layout, so the landing and the static judge pages do not ship it. */}
            {children}
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}

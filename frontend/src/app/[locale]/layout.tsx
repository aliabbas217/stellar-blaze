import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { fontClassFor } from "@/app/fonts";
import { titleTemplate } from "@/app/titles";
import { themeScript } from "@/components/shell/theme-script";
import { dirFor } from "@/i18n/direction";
import { routing } from "@/i18n/routing";
import "@/styles/globals.css";

/*
 * The root layout of the app (there is no app/layout.tsx: next-intl and Next.js `root-params` need the
 * [locale] segment above the root layout). It owns <html>, so `lang` and `dir` are always set: tokens.css
 * keys letter-spacing on :lang(en) and globals.css keys line height on :lang(ar) and :lang(ur).
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
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    // suppressHydrationWarning: the inline theme script sets data-theme on <html> before React hydrates.
    <html lang={locale} dir={dirFor(locale)} className={fontClassFor(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

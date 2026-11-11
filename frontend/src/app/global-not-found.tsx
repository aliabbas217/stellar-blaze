import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fontClassFor } from "@/app/fonts";
import { titleWithAppName } from "@/app/titles";
import { themeScript } from "@/components/shell/theme-script";
import { buttonVariants } from "@/components/ui/button";
import { getCookieLocale } from "@/i18n/cookie-locale";
import { dirFor } from "@/i18n/direction";
import "@/styles/globals.css";

/*
 * The 404 for every URL no route matches (see experimental.globalNotFound in next.config.ts). It renders
 * outside the [locale] layout, so there is no route parameter to read: the language is the locale cookie that
 * the proxy sets from the URL prefix (so /ur/typo answers in Urdu), else the default. A page that calls notFound()
 * itself is not served by this file (Next.js returns 404 with a client-rendered shell); pages under [locale]
 * should show their own empty or error state instead.
 *
 * This file is outside the layout's metadata too, so it sets its own <title> (WCAG 2.4.2). No `robots` is set
 * here: Next.js adds <meta name="robots" content="noindex"> to every 404 itself, and setting it again
 * rendered the tag twice (checked in the production build).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getCookieLocale();
  const t = await getTranslations({ locale, namespace: "shell.notFound" });
  const common = await getTranslations({ locale, namespace: "common" });
  return { title: titleWithAppName(t("title"), common("appName")) };
}

export default async function GlobalNotFound() {
  const locale = await getCookieLocale();
  const t = await getTranslations({ locale, namespace: "shell.notFound" });

  return (
    <html lang={locale} dir={dirFor(locale)} className={fontClassFor(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start gap-6 px-4 py-12">
          <h1 className="font-display text-3xl font-bold tracking-signage">{t("title")}</h1>
          <p className="text-lg text-ink-muted">{t("body")}</p>
          {/* A full document load is intended: this 404 sits outside the locale layout and provider, and the proxy sends "/" to the visitor's locale. The rule reports it only because it reads app/[locale]/page.tsx as a page at "/" (its [param] regex also matches an empty segment). */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see the comment above */}
          <a href="/" className={buttonVariants()}>
            {t("home")}
          </a>
        </main>
      </body>
    </html>
  );
}

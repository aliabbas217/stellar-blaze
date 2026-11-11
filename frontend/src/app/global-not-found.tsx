import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { fontClassFor } from "@/app/fonts";
import { themeScript } from "@/components/shell/theme-script";
import { buttonVariants } from "@/components/ui/button";
import { dirFor } from "@/i18n/direction";
import { routing } from "@/i18n/routing";
import "@/styles/globals.css";

/*
 * The 404 for every URL no route matches (see experimental.globalNotFound in next.config.ts). It renders
 * outside the [locale] layout, so there is no route parameter to read: the language is the NEXT_LOCALE cookie that
 * the proxy sets from the URL prefix (so /ur/typo answers in Urdu), else the default. A page that calls notFound()
 * itself is not served by this file (Next.js returns 404 with a client-rendered shell); pages under [locale]
 * should show their own empty or error state instead.
 */
export default async function GlobalNotFound() {
  const stored = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = hasLocale(routing.locales, stored) ? stored : routing.defaultLocale;
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
          <a href="/" className={buttonVariants()}>
            {t("home")}
          </a>
        </main>
      </body>
    </html>
  );
}

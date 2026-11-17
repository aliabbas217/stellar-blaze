// @vitest-environment node
import { cookies } from "next/headers";
import { renderToStaticMarkup } from "react-dom/server";
import GlobalNotFound, { generateMetadata } from "@/app/global-not-found";
import type { Messages } from "@/i18n/request";
import { LOCALE_COOKIE_NAME, type Locale } from "@/i18n/routing";
import { requestCookies } from "../../utils/request-cookies";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// next/font only works inside the Next.js compiler; the class it returns is irrelevant to these assertions.
vi.mock("@/app/fonts", () => ({ fontClassFor: (locale: string) => `font-for-${locale}` }));

// The real translator on the real message files; only the request-scoped lookup of next-intl/server is replaced.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: en } = await import("../../../messages/en.json");
  const { default: ar } = await import("../../../messages/ar.json");
  const { default: ur } = await import("../../../messages/ur.json");
  const { default: hi } = await import("../../../messages/hi.json");
  const { default: bn } = await import("../../../messages/bn.json");
  const { default: ne } = await import("../../../messages/ne.json");
  const all: Record<Locale, Messages> = { en, ar, ur, hi, bn, ne };
  return {
    getTranslations: ({ locale, namespace }: { locale: Locale; namespace: "shell.notFound" | "common" }) =>
      Promise.resolve(createTranslator({ locale, messages: all[locale], namespace })),
  };
});

function withLocaleCookie(locale?: string): void {
  vi.mocked(cookies).mockResolvedValue(requestCookies(locale === undefined ? undefined : `${LOCALE_COOKIE_NAME}=${locale}`));
}

describe("global-not-found metadata", () => {
  it("gives the 404 document a localized <title> with the app name (WCAG 2.4.2)", async () => {
    withLocaleCookie("en");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Page not found · Stellar Blaze");
  });

  it("follows the locale cookie", async () => {
    withLocaleCookie("ur");
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("صفحہ نہیں ملا · Stellar Blaze");
  });

  it.each([undefined, "xx"])("is English for cookie %j", async (cookie) => {
    withLocaleCookie(cookie);
    const metadata = await generateMetadata();
    expect(metadata.title).toBe("Page not found · Stellar Blaze");
  });

  it.each(["en", "ar", "ur", "hi", "bn", "ne"] satisfies Locale[])("has a non-empty title in %s", async (locale) => {
    withLocaleCookie(locale);
    const { title } = await generateMetadata();
    expect(typeof title === "string" && title.trim().length > 0).toBe(true);
  });
});

describe("global-not-found document", () => {
  it("is a complete localized document: lang, dir and the localized heading", async () => {
    withLocaleCookie("ur");
    const html = renderToStaticMarkup(await GlobalNotFound());
    expect(html).toContain('<html lang="ur" dir="rtl"');
    expect(html).toContain("font-for-ur");
    expect(html).toContain("صفحہ نہیں ملا</h1>");
  });

  it("is English and left-to-right without a cookie", async () => {
    withLocaleCookie();
    const html = renderToStaticMarkup(await GlobalNotFound());
    expect(html).toContain('<html lang="en" dir="ltr"');
    expect(html).toContain("Page not found</h1>");
  });
});

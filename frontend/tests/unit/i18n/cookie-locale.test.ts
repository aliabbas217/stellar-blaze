// @vitest-environment node
import { cookies } from "next/headers";
import { getCookieLocale, localeFromCookieValue } from "@/i18n/cookie-locale";
import { LOCALE_COOKIE_NAME, routing } from "@/i18n/routing";
import { requestCookies } from "../../utils/request-cookies";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

describe("localeFromCookieValue", () => {
  it.each(routing.locales)("accepts %s", (locale) => {
    expect(localeFromCookieValue(locale)).toBe(locale);
  });

  it.each([undefined, "", "xx", "EN", "en-GB", "../etc", "<script>"])("falls back to the default for %j", (value) => {
    expect(localeFromCookieValue(value)).toBe(routing.defaultLocale);
  });
});

describe("getCookieLocale", () => {
  it("reads the cookie the proxy writes, by the name the routing config declares", async () => {
    vi.mocked(cookies).mockResolvedValue(requestCookies(`${LOCALE_COOKIE_NAME}=ur`));
    await expect(getCookieLocale()).resolves.toBe("ur");
  });

  it("ignores a cookie of another name", async () => {
    vi.mocked(cookies).mockResolvedValue(requestCookies("locale=ur"));
    await expect(getCookieLocale()).resolves.toBe("en");
  });

  it("is the default locale when there is no cookie", async () => {
    vi.mocked(cookies).mockResolvedValue(requestCookies());
    await expect(getCookieLocale()).resolves.toBe("en");
  });
});

describe("routing config", () => {
  it("names the locale cookie explicitly, so the proxy and the 404 page cannot drift apart", () => {
    expect(LOCALE_COOKIE_NAME).toBe("NEXT_LOCALE");
    expect(routing.localeCookie).toMatchObject({ name: LOCALE_COOKIE_NAME });
  });
});

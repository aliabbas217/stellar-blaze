import { dirFor } from "@/i18n/direction";
import { routing } from "@/i18n/routing";

describe("dirFor", () => {
  it.each(["ar", "ur"] as const)("is rtl for %s", (locale) => {
    expect(dirFor(locale)).toBe("rtl");
  });

  it.each(["en", "hi", "bn", "ne"] as const)("is ltr for %s", (locale) => {
    expect(dirFor(locale)).toBe("ltr");
  });

  it("covers every routed locale with one of the two directions", () => {
    for (const locale of routing.locales) {
      expect(["ltr", "rtl"], locale).toContain(dirFor(locale));
    }
  });
});

describe("routing", () => {
  it("serves the six locales with en as the default", () => {
    expect(routing.locales).toEqual(["en", "ar", "ur", "hi", "bn", "ne"]);
    expect(routing.defaultLocale).toBe("en");
  });
});

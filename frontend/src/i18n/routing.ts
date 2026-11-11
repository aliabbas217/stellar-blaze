import { defineRouting } from "next-intl/routing";

/**
 * The six supported locales. `en` is the source language and the default; `ar` and `ur` are
 * right-to-left (see direction.ts). Adding a locale means a messages file, a direction, a font
 * and a loader in request.ts: each of those is an exhaustive Record, so the compiler lists what is missing.
 */
export const routing = defineRouting({
  locales: ["en", "ar", "ur", "hi", "bn", "ne"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];

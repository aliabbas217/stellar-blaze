import { hasLocale, type Formats } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import type enMessages from "../../messages/en.json";
import { routing, type Locale } from "./routing";

/**
 * en is the type of every catalogue, except `_meta.safety_keys`: the machine-readable list of the safety strings lives in en alone
 * (tests/unit/i18n/messages-parity.test.ts asserts every listed key exists in all six), so the other five do not carry it, and a list
 * is not a message (next-intl's `AbstractIntlMessages` has no arrays), so the type leaves it out; nothing reads it at runtime.
 */
export type Messages = Omit<typeof enMessages, "_meta"> & { readonly _meta: { readonly review_status: string } };

// One explicit loader per locale: typed (a file whose keys differ from en does not compile), exhaustive
// (a new locale does not compile without one), and each file becomes its own lazily loaded chunk.
const loaders: Readonly<Record<Locale, () => Promise<{ default: Messages }>>> = {
  en: () => import("../../messages/en.json"),
  ar: () => import("../../messages/ar.json"),
  ur: () => import("../../messages/ur.json"),
  hi: () => import("../../messages/hi.json"),
  bn: () => import("../../messages/bn.json"),
  ne: () => import("../../messages/ne.json"),
};

/**
 * Named formats for times and numbers. `numberingSystem: "latn"` keeps Western digits in every
 * locale: without it Bengali and Nepali render times and temperatures in their own digits
 * (checked against Node's ICU: bn gives ১৩:০৫, ne gives १३:०५). Times are 24-hour.
 * Callers still pass the site's own `timeZone` (it is data, not a default).
 */
export const formats = {
  dateTime: {
    time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23", numberingSystem: "latn" },
  },
  number: {
    integer: { maximumFractionDigits: 0, numberingSystem: "latn" },
    temperature: { maximumFractionDigits: 1, numberingSystem: "latn" },
    percent: { style: "percent", maximumFractionDigits: 0, numberingSystem: "latn" },
  },
} satisfies Formats;

/**
 * Only a fallback so server and browser format a date identically when a caller forgets the site's
 * time zone (the server runtime is usually UTC). The UAE has one zone and no daylight saving.
 */
const FALLBACK_TIME_ZONE = "Asia/Dubai";

export default getRequestConfig(async ({ locale }) => {
  // The locale comes from the [locale] root layout through next/root-params (next-intl's current
  // pattern; the older requestLocale argument is deprecated). `locale` is only set when a caller
  // passes an explicit override, e.g. getTranslations({ locale }).
  const candidate: string = locale ?? (await rootParams.locale());
  // An unknown prefix such as /xx/... lands here (the [locale] segment matches anything): 404 it.
  if (!hasLocale(routing.locales, candidate)) notFound();

  const messages = (await loaders[candidate]()).default;
  return { locale: candidate, messages, formats, timeZone: FALLBACK_TIME_ZONE };
});

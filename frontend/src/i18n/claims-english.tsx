import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { dirFor } from "./direction";
import type { Locale } from "./routing";

/**
 * The claims surfaces (scoreboard, frontier, proof, day, try, governance) stay English in every catalogue, by design: their
 * sentences carry numbers the verifier checks and verdicts that come verbatim from English files, so a machine translation of
 * them would be an unverified claim (F2 Task 22, controller ruling 1). In an RTL page such a block is marked
 * `lang="en" dir="ltr"`: bidi, punctuation and hyphenation are right, and a screen reader keeps an English voice. The page
 * chrome, the nav and the language chips keep the active locale. A translated piece that sits inside a claims block restores
 * the page's language with `useLocaleAttrs` (use-locale-attrs.ts).
 */
export const CLAIMS_ENGLISH = { lang: "en", dir: "ltr" } as const;

/**
 * Locales whose claims surfaces ARE translated (ADR 0083 amendment 2026-11-20: Arabic, by the owner's ruling). In such a page a claims
 * block is in the page's own language and direction; text that is verbatim English by nature (a legal clause, a sentence a scoring run
 * wrote) still carries `CLAIMS_ENGLISH` itself. Kept equal to `CLAIMS_TRANSLATED_LOCALES` of scripts/i18n-sync.mjs by a unit test.
 */
export const CLAIMS_TRANSLATED_LOCALES: readonly Locale[] = ["ar"];

const isClaimsTranslated = (locale: string): locale is Locale => (CLAIMS_TRANSLATED_LOCALES as readonly string[]).includes(locale);

/** `lang` and `dir` of a claims block on a page in `locale`: English and left to right, unless that locale's claims are translated. */
export function claimsAttrs(locale: string): { readonly lang: string; readonly dir: "ltr" | "rtl" } {
  return isClaimsTranslated(locale) ? { lang: locale, dir: dirFor(locale) } : CLAIMS_ENGLISH;
}

/** `claimsAttrs` for the page's locale: for a component that renders a claims block. */
export function useClaimsAttrs() {
  return claimsAttrs(useLocale());
}

/**
 * The locale a claims block formats dates, numbers and lists in: English, whatever the page language, because its sentences are English
 * ("15 May to 30 Sep", not "15 مايو to 30 سبتمبر"); the page's own language where the claims are translated (Arabic), so a sentence and its
 * dates agree. A claims view calls `claimsLocale(useLocale())`.
 */
export function claimsLocale(pageLocale: string): string {
  return isClaimsTranslated(pageLocale) ? pageLocale : "en";
}

/** A claims block with no box of its own: `display: contents` keeps the layout of the page it wraps. */
export function ClaimsEnglish({ children }: { readonly children: ReactNode }) {
  const attrs = useClaimsAttrs();
  return (
    <div {...attrs} data-claims-english="" className="contents">
      {children}
    </div>
  );
}

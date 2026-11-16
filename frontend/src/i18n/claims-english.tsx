import type { ReactNode } from "react";

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
 * The locale a claims block formats dates, numbers and lists in: English, whatever the page language, because its sentences are English
 * ("15 May to 30 Sep", not "15 مايو to 30 سبتمبر"). A claims view reads this where a translated view reads `useLocale()`
 * (tests/unit/i18n/claims-english.test.tsx keeps `useLocale` out of them).
 */
export const CLAIMS_LOCALE = "en" as const;

/** A claims block with no box of its own: `display: contents` keeps the layout of the page it wraps. */
export function ClaimsEnglish({ children }: { readonly children: ReactNode }) {
  return (
    <div {...CLAIMS_ENGLISH} data-claims-english="" className="contents">
      {children}
    </div>
  );
}

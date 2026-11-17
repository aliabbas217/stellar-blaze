import { useLocale } from "next-intl";
import { dirFor } from "./direction";

/**
 * `lang` and `dir` of the page's own language, for the root of a translated component that can sit inside a claims block
 * (claims-english.tsx), which is English and left to right. Outside such a block it repeats what `<html>` already says.
 */
export function useLocaleAttrs() {
  const locale = useLocale();
  return { lang: locale, dir: dirFor(locale) } as const;
}

import type { formats, Messages } from "./request";
import type { Locale } from "./routing";

// Types next-intl's hooks with the real locales, message keys and named formats, so a
// missing key or an unknown locale fails `tsc` instead of rendering a raw key at runtime.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
    Formats: typeof formats;
  }
}

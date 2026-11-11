/** Between a page title and the app name in `<title>`: "Page not found · Stellar Blaze". Language-neutral. */
export const TITLE_SEPARATOR = " · ";

/** The page title with the app name after it, for documents rendered outside the [locale] layout's `title.template`. */
export function titleWithAppName(title: string, appName: string): string {
  return `${title}${TITLE_SEPARATOR}${appName}`;
}

/** Next.js `title.template` for the [locale] layout: "%s · Stellar Blaze". */
export function titleTemplate(appName: string): string {
  return `%s${TITLE_SEPARATOR}${appName}`;
}

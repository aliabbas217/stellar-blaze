import { SW_STRINGS } from "@/features/push/sw-strings";
import type { PushLevel, PushPayload } from "@/features/push/payload";
import { routing, type Locale } from "@/i18n/routing";

/*
 * What a push becomes on the phone: the text, the vibration and the page a tap opens. Pure, bundled into the service
 * worker (src/app/sw.ts). The words come from sw-strings.ts, generated from messages/*.json (scripts/build-sw-strings.ts);
 * the payload itself carries no text, only a level and ids (docs/contracts/web-push.md).
 */

interface PushStrings {
  readonly appName: string;
  readonly title: { readonly site: string; readonly crew: string };
  readonly body: string;
  readonly level: Readonly<Record<PushLevel, string>>;
}

// Typed against Locale on purpose: a locale added to routing.ts without messages does not compile here.
const STRINGS: Readonly<Record<Locale, PushStrings>> = SW_STRINGS;

// A pattern a gloved hand can tell apart in a pocket: the more serious the level, the longer and more repeated.
const VIBRATION: Readonly<Record<PushLevel, readonly number[]>> = {
  green: [],
  amber: [200],
  orange: [200, 100, 200],
  red: [400, 100, 400, 100, 400],
};

export interface NotificationContent {
  readonly title: string;
  readonly body: string;
  /** One notification per audience and target: a new level replaces the old one instead of piling up. */
  readonly tag: string;
  readonly vibrate: number[];
  /** The language the text is in (a supported locale), so a screen reader pronounces it. */
  readonly lang: Locale;
  /**
   * Chromium: alert again when a notification with the same tag is replaced. Without it a level change from amber to
   * red at the same site would swap the text silently, which is the one change that must not be silent.
   */
  readonly renotify: boolean;
}

/** The locale to use for `locale`: itself when supported, else the default. Exact match, so "constructor" is not one. */
function supportedLocale(locale: string): Locale {
  return routing.locales.find((candidate) => candidate === locale) ?? routing.defaultLocale;
}

/** The page a tap on the notification opens: the worker route in the worker's own language. */
export function notificationTargetUrl(locale: string, payload: PushPayload): string {
  return `/${supportedLocale(locale)}/worker?from=push&level=${payload.level}`;
}

/**
 * `template` with its `{level}` slot filled. A function replacer, so a level name that contains a dollar-ampersand,
 * dollar-quote or dollar-digit sequence (a translation, which is data we do not control) is inserted as written
 * instead of being read as a replacement pattern.
 */
export function fillLevel(template: string, levelName: string): string {
  return template.replace("{level}", () => levelName);
}

/** The notification to show for `payload` in `locale`. */
export function notificationContent(locale: string, payload: PushPayload): NotificationContent {
  const resolved = supportedLocale(locale);
  const strings = STRINGS[resolved];
  const levelName = strings.level[payload.level];
  return {
    title: fillLevel(strings.title[payload.audience], levelName),
    body: strings.body,
    tag: `${payload.audience}:${payload.target_id}`,
    vibrate: [...VIBRATION[payload.level]],
    lang: resolved,
    renotify: true,
  };
}

/**
 * The tag of the neutral notification. It has no colon, so it can never equal a level notification's
 * `audience:target_id`, and it is never empty (`renotify` needs a tag).
 */
export const FALLBACK_NOTIFICATION_TAG = "fallback";

/** Where a tap on the neutral notification goes: the worker route, no level (none was received). */
export function fallbackTargetUrl(locale: string): string {
  return `/${supportedLocale(locale)}/worker?from=push`;
}

/**
 * The notification for a push the worker cannot read (no body, not JSON, not the contract's six keys, a version it does
 * not know): the app's name and the generic "open the app" line, claiming no level. It exists because an installed
 * Safari app has its push subscription revoked after pushes that show nothing (WebKit, "Meet Declarative Web Push"),
 * and Chrome shows a notice of its own then; a notification that sends the worker to the app is safer than either.
 */
export function fallbackNotificationContent(locale: string): NotificationContent {
  const resolved = supportedLocale(locale);
  const strings = STRINGS[resolved];
  return {
    title: strings.appName,
    body: strings.body,
    tag: FALLBACK_NOTIFICATION_TAG,
    // One buzz shorter than any level's pattern: it asks for attention without claiming a level.
    vibrate: [100],
    lang: resolved,
    renotify: true,
  };
}

// Only the origin matters; the host is never contacted.
const PLACEHOLDER_ORIGIN = "https://worker.invalid";

/**
 * Where a tap goes: the url stored in the notification when it is a path on this origin, else the worker route of
 * `locale`. The notification is ours, but its data is read back from the browser, so it is checked rather than trusted
 * (an absolute, protocol-relative or backslash url would leave the app).
 */
export function notificationClickUrl(data: unknown, locale: string): string {
  const fallback = `/${supportedLocale(locale)}/worker`;
  if (typeof data !== "object" || data === null || !("url" in data) || typeof data.url !== "string") return fallback;
  if (!data.url.startsWith("/")) return fallback;
  try {
    const url = new URL(data.url, PLACEHOLDER_ORIGIN);
    return url.origin === PLACEHOLDER_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

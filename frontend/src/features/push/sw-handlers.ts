import {
  fallbackNotificationContent,
  fallbackTargetUrl,
  notificationClickUrl,
  notificationContent,
  notificationTargetUrl,
  type NotificationContent,
} from "@/features/push/notification";
import { parsePushPayload } from "@/features/push/payload";
import { routing } from "@/i18n/routing";

/*
 * The logic behind the service worker's `push` and `notificationclick` listeners (src/app/sw.ts wires them to the
 * worker's globals). It takes its dependencies as arguments so it runs in unit tests without a worker.
 *
 * Push subscriptions are POST and DELETE requests from the page; none of them goes through the worker's runtime
 * caching (src/features/pwa/runtime-caching.ts has no route for a method other than GET). Nothing here touches that
 * list and nothing here may be added to it.
 */

/** Where the notification icon is served from (public/icons, precached by the worker). */
const NOTIFICATION_ICON = "/icons/icon-192.png";

/** `NotificationOptions` plus the two members every Chromium honours and lib.webworker does not declare. */
export interface PushNotificationOptions extends NotificationOptions {
  vibrate: number[];
  renotify: boolean;
}

export interface PushDeps {
  /** The language the page last stored (features/pwa/prefs.ts). */
  readLocale(): Promise<string>;
  show(title: string, options: PushNotificationOptions): Promise<void>;
}

/** What the push carried, parsed, or undefined when it carried nothing readable. Never throws. */
export function readPushData(event: { readonly data: { json(): unknown } | null }): unknown {
  try {
    return event.data?.json();
  } catch {
    // Not JSON: undefined, which the guard rejects, which gets the neutral notification.
    return undefined;
  }
}

function toOptions(content: NotificationContent, url: string): PushNotificationOptions {
  return {
    body: content.body,
    tag: content.tag,
    lang: content.lang,
    vibrate: content.vibrate,
    renotify: content.renotify,
    icon: NOTIFICATION_ICON,
    // The tap reads this back (notificationClickUrl): the page it opens is decided when the notification is built.
    data: { url },
  };
}

/**
 * Shows exactly one notification for every push, because a push that shows none gets the subscription revoked by WebKit
 * (an installed iPhone app) and a notice of Chrome's own on Chromium.
 *
 *  - A payload that is exactly the contract's six keys with valid values: the level notification built from it.
 *    Resolves "payload".
 *  - Anything else (no body, not JSON, an extra key, an unknown level or version, a malformed time): the neutral
 *    notification, the app's name and the generic "open the app" line with a fixed tag, which claims no level and never
 *    shows text the payload supplied. Resolves "fallback". It is not rethrown: a worker must never fail on a message it
 *    does not understand.
 *
 * A failure of `show` itself (permission withdrawn, no icon) is not swallowed: it surfaces in the worker's console,
 * which is where the real-phone spike looks for it.
 */
export async function showPushNotification(data: unknown, deps: PushDeps): Promise<"payload" | "fallback"> {
  const payload = parsePushPayload(data);
  const locale = await deps.readLocale().catch(() => routing.defaultLocale);
  if (payload === null) {
    const content = fallbackNotificationContent(locale);
    await deps.show(content.title, toOptions(content, fallbackTargetUrl(content.lang)));
    return "fallback";
  }
  const content = notificationContent(locale, payload);
  await deps.show(content.title, toOptions(content, notificationTargetUrl(content.lang, payload)));
  return "payload";
}

/** The part of `WindowClient` the tap handler uses. */
export interface ClientLike {
  readonly url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}

export interface ClickDeps {
  readonly origin: string;
  readLocale(): Promise<string>;
  /** Every open window of the app, including ones the worker does not control yet. */
  windows(): Promise<readonly ClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/**
 * What a tap on a notification does: bring the window that is already on the target page to the front and give it the
 * target's query (`?from=push&level=`, which the page reads), else open the target in a new window. A window on another
 * page of the app is left alone rather than navigated: it may hold a half-filled form, and the target is one tap away
 * from wherever it is. A window that cannot be focused (it went away) is replaced by a new one.
 */
export async function openNotificationTarget(data: unknown, deps: ClickDeps): Promise<void> {
  const locale = await deps.readLocale().catch(() => routing.defaultLocale);
  const target = new URL(notificationClickUrl(data, locale), deps.origin);
  const targetPath = `${target.pathname}${target.search}${target.hash}`;

  const open = (await deps.windows()).find((client) => {
    const url = new URL(client.url);
    return url.origin === target.origin && url.pathname === target.pathname;
  });
  if (open === undefined) {
    await deps.openWindow(targetPath);
    return;
  }

  try {
    await open.focus();
  } catch {
    await deps.openWindow(targetPath);
    return;
  }
  if (new URL(open.url).search !== target.search) {
    // Only a window this worker controls can be navigated; an uncontrolled one is already in front, which is enough.
    await open.navigate(targetPath).catch(() => undefined);
  }
}

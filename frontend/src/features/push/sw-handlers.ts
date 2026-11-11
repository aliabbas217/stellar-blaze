import {
  notificationClickUrl,
  notificationContent,
  notificationTargetUrl,
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
    // Not JSON: the guard below sees undefined and shows nothing.
    return undefined;
  }
}

/**
 * Shows the notification for a push. A payload that is not exactly the contract's six keys with valid values shows
 * nothing and is not rethrown: a worker must never fail on a message it does not understand, and must never show
 * text it did not build itself. Resolves true when a notification was shown.
 *
 * A failure of `show` itself (permission withdrawn, no icon) is not swallowed: it surfaces in the worker's console,
 * which is where the real-phone spike looks for it.
 */
export async function showPushNotification(data: unknown, deps: PushDeps): Promise<boolean> {
  const payload = parsePushPayload(data);
  if (payload === null) return false;

  const locale = await deps.readLocale().catch(() => routing.defaultLocale);
  const content = notificationContent(locale, payload);
  await deps.show(content.title, {
    body: content.body,
    tag: content.tag,
    lang: content.lang,
    vibrate: content.vibrate,
    renotify: content.renotify,
    icon: NOTIFICATION_ICON,
    // The tap reads this back (notificationClickUrl): the page it opens is decided when the notification is built.
    data: { url: notificationTargetUrl(content.lang, payload) },
  });
  return true;
}

/** The part of `WindowClient` the tap handler uses. */
export interface ClientLike {
  readonly url: string;
  focus(): Promise<unknown>;
}

export interface ClickDeps {
  readonly origin: string;
  readLocale(): Promise<string>;
  /** Every open window of the app, including ones the worker does not control yet. */
  windows(): Promise<readonly ClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/**
 * What a tap on a notification does: focus the window that is already on the target page, else open the target in a
 * new one. A window on another page of the app is left alone rather than navigated: it may hold a half-filled
 * form, and the target is one tap away from wherever it is.
 */
export async function openNotificationTarget(data: unknown, deps: ClickDeps): Promise<void> {
  const locale = await deps.readLocale().catch(() => routing.defaultLocale);
  const target = new URL(notificationClickUrl(data, locale), deps.origin);

  const open = (await deps.windows()).find((client) => {
    const url = new URL(client.url);
    return url.origin === target.origin && url.pathname === target.pathname;
  });
  if (open !== undefined) {
    await open.focus();
    return;
  }
  await deps.openWindow(`${target.pathname}${target.search}${target.hash}`);
}

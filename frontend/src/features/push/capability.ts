/*
 * What this browser can do about Web Push, decided from features rather than from the browser's name. The Alerts
 * screen shows a different thing for each answer (review focus 4): the Enable button, an install card, or an
 * explanation. The decision is a pure function of an environment snapshot so every case is unit tested; reading the
 * snapshot from the real browser is the only part that touches globals.
 */

export type PushCapability = "supported" | "ios-needs-install" | "unsupported" | "insecure";

export interface PushEnv {
  readonly isSecureContext: boolean;
  readonly hasServiceWorker: boolean;
  readonly hasPushManager: boolean;
  readonly hasNotification: boolean;
  readonly isIos: boolean;
  /** The page runs as an installed app (Home Screen on iOS, an installed PWA elsewhere). */
  readonly isStandalone: boolean;
}

/**
 * Order matters:
 *  1. An insecure address cannot register a service worker or ask for permission, whatever the device is, and
 *     installing the app does not change that, so it is answered first.
 *  2. On an iPhone or iPad Safari only exposes PushManager to an app added to the Home Screen (iOS 16.4 and later).
 *     No PushManager in a browser tab there means "install first". Standalone without PushManager is an iOS that is too
 *     old, which an install cannot fix, so it falls through to unsupported.
 *  3. Anything missing (service worker, PushManager, Notification) is unsupported.
 */
export function pushCapability(env: PushEnv): PushCapability {
  if (!env.isSecureContext) return "insecure";
  if (env.isIos && !env.isStandalone && !env.hasPushManager) return "ios-needs-install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  return "supported";
}

/** The environment of the browser this code runs in. Client only (reads window and navigator). */
export function readPushEnv(): PushEnv {
  // iPadOS 13 and later announces itself as a Mac; a Mac has no touch screen.
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  // `navigator.standalone` is Safari's own flag (not in lib.dom); display-mode is the standard one.
  const iosStandalone = "standalone" in navigator && navigator.standalone === true;
  return {
    isSecureContext: window.isSecureContext,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    isIos,
    isStandalone: iosStandalone || window.matchMedia("(display-mode: standalone)").matches,
  };
}

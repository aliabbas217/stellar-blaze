"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";
import { writeLocalePref } from "@/features/pwa/prefs";
import { checkForNewWorkerOnce } from "@/features/pwa/update-check";

/**
 * Tells the service worker which language this page is in (features/pwa/prefs.ts), on every locale render, so a push
 * that arrives while the app is closed is shown in the worker's own language. It also asks the browser, once per page load,
 * to look for a newer service worker (features/pwa/update-check.ts). Renders nothing.
 */
export function LocalePrefs() {
  const locale = useLocale();
  useEffect(() => {
    // Best effort: Cache Storage can be missing or blocked (private window, insecure address). The worker then falls
    // back to English, which is worse than the worker's language but still a notification.
    writeLocalePref(locale).catch(() => undefined);
  }, [locale]);
  useEffect(() => {
    checkForNewWorkerOnce();
  }, []);
  return null;
}

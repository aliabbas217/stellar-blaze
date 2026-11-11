"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type ThemeChoice } from "./theme-script";

const NEXT_CHOICE: Readonly<Record<ThemeChoice, ThemeChoice>> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const listeners = new Set<() => void>();

/** The attribute on <html> is the source of truth: the inline script sets it from storage before paint. */
function readChoice(): ThemeChoice {
  const current = document.documentElement.dataset["theme"];
  return current === "light" || current === "dark" ? current : "system";
}

function applyChoice(choice: ThemeChoice): void {
  if (choice === "system") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = choice;
  }
  for (const notify of listeners) notify();
}

function persist(choice: ThemeChoice): void {
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked or full. The choice still applies for this visit; it just is not remembered.
  }
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  // Another tab changed the override: follow it.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    const stored = event.newValue;
    applyChoice(stored === "light" || stored === "dark" ? stored : "system");
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", onStorage);
  };
}

/** Cycles system, light, dark and remembers the choice on this device. */
export function ThemeToggle() {
  const t = useTranslations("shell");
  const choice = useSyncExternalStore(subscribe, readChoice, (): ThemeChoice => "system");

  return (
    <button
      type="button"
      onClick={() => {
        const next = NEXT_CHOICE[choice];
        persist(next);
        applyChoice(next);
      }}
      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-sign border-2 border-control bg-surface px-4 font-body text-sm text-ink transition-state"
    >
      {t("theme.current", { mode: t(`theme.${choice}`) })}
    </button>
  );
}

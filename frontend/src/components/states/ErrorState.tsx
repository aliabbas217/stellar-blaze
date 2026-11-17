"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";
import { ACTION_PRIMARY, ACTION_SECONDARY } from "./actions";

export interface ErrorStateProps {
  readonly title: string;
  readonly detail: string;
  readonly onRetry: () => void;
  /** The server's request id, so a person can read it to someone who can look it up. Null when the failure had none. */
  readonly requestId: string | null;
  /** What to do until it loads (the site rules): an error is never a dead end. */
  readonly children?: ReactNode;
}

/**
 * Something failed to load. Says what, offers the retry, and shows the request id with a one-tap copy: the id is the
 * only technical detail a person is asked to pass on, so it is the one place an identifier appears in product copy.
 */
export function ErrorState({ title, detail, onRetry, requestId, children }: ErrorStateProps) {
  const t = useTranslations("states");
  const attrs = useLocaleAttrs();
  const [copied, setCopied] = useState(false);

  async function copy(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      // Clipboard access can be refused (an insecure context, a denied permission). The id stays on screen to read out.
    }
  }

  return (
    <section {...attrs} role="alert" className="flex flex-col items-start gap-3 rounded-sign border border-edge px-6 py-8">
      <h2 className="font-display text-lg font-medium">{title}</h2>
      <p className="max-w-(--measure) text-base text-ink-2">{detail}</p>
      {children}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className={ACTION_PRIMARY}>
          {t("retry")}
        </button>
      </div>
      {requestId === null ? null : (
        <div className="flex flex-wrap items-center gap-3 text-base text-ink-3">
          <p>
            <span>{t("requestIdLabel")}</span> <code dir="ltr" translate="no" className="font-mono text-sm text-ink-2">{requestId}</code>
          </p>
          <button type="button" onClick={() => void copy(requestId)} className={ACTION_SECONDARY}>
            {t("error.copy")}
          </button>
          {/* Always mounted, so a screen reader hears the change when the text arrives. */}
          <span role="status" className="text-base text-ink-2">
            {copied ? t("error.copied") : ""}
          </span>
        </div>
      )}
    </section>
  );
}

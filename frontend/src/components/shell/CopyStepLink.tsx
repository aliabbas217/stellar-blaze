"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * "Copy link to this step": copies the address of the current page without its query or hash, so a step is shared as the
 * step and not as one reader's slider position. The result is spoken through a polite live region; it clears after a few
 * seconds so the button never keeps saying "copied" about an old click.
 */
export function CopyStepLink() {
  const t = useTranslations("judge.story");
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  function done(next: CopyState) {
    setState(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setState("idle");
    }, 4000);
  }

  function copy() {
    const link = `${window.location.origin}${window.location.pathname}`;
    navigator.clipboard.writeText(link).then(
      () => {
        done("copied");
      },
      () => {
        done("failed");
      },
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-12 items-center justify-center rounded-sign border border-edge bg-ground px-4 text-base text-ink hover:bg-panel"
      >
        {t("copy")}
      </button>
      <span role="status" className="text-sm text-ink-2">
        {state === "copied" ? t("copied") : state === "failed" ? t("copyFailed") : null}
      </span>
    </span>
  );
}

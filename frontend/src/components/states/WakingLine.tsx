"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";

/*
 * The one quiet line a LIVE loading state adds when the API is slow to answer. In the cheap hosting mode the API scales to zero and
 * the first read after a quiet period waits for it to wake (about 30 s measured), and the BFF waits that out (UPSTREAM_READ_TIMEOUT_MS)
 * instead of showing an error. So the screen stays in its ordinary loading state, and after 3 seconds says why it is taking longer.
 * No number and no claim: it is not a countdown and it says nothing about safety.
 *
 * Mount it INSIDE the loading state and nowhere else: the loading state going away is the read settling, which unmounts this and
 * clears its timer, so no separate "settled" signal exists to get out of step. It starts when the loading state mounts (about
 * when the request starts; a Suspense fallback replaced by the screen's own loading state restarts it, a few milliseconds late).
 *
 *  - One timer, set in an effect, so the server's HTML and the first client render are the same (an empty live region) and nothing
 *    can mismatch when it hydrates.
 *  - `role="status"` (a polite live region) is in the document from the start and empty, so the sentence is announced when it
 *    arrives. It is a SIBLING of the skeleton's own status region, not inside it: that one is `aria-busy`, and a change inside a
 *    busy region is not announced.
 *  - No layout shift: an invisible copy of the sentence (`visibility: hidden`, `aria-hidden`) sits in the same grid cell and holds
 *    exactly the room the sentence takes in the active language and width, so its arrival moves nothing. No animation.
 *
 * The English source is `states.waking`. Do not use it for static pages built from committed data (nothing there waits on the API),
 * nor on the Stop bar or the unwell sheet (Stop has its own limit; the unwell sheet makes no request).
 */

/** How long the loading state has to last before the line appears. */
export const WAKING_DELAY_MS = 3000;

export function WakingLine({ className }: { readonly className?: string }) {
  const t = useTranslations("states");
  // The replay surfaces that mount this sit inside the claims-English wrapper (lang="en" dir="ltr"): the sentence is translated, so its
  // root says the page's language and direction again (the same treatment as Banner, Stamp and StoryNav).
  const attrs = useLocaleAttrs();
  const [due, setDue] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDue(true);
    }, WAKING_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  const sentence = t("waking");
  return (
    <div {...attrs} className={`grid text-base leading-(--sign-leading-text) text-ink-2 ${className ?? ""}`} data-waking="">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {sentence}
      </span>
      <p role="status" className="col-start-1 row-start-1">
        {due ? sentence : null}
      </p>
    </div>
  );
}

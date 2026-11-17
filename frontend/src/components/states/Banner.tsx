import type { ReactNode } from "react";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";

/**
 * The one banner shape of the state components: a panel with a hairline frame and a 3 px rule on the inline start, the
 * rule in ink so it is never mistaken for a level. It is a polite live region: a banner that appears (the phone went
 * offline, the forecast went stale) is announced without taking focus.
 */
export function Banner({
  children,
  icon,
}: {
  readonly children: ReactNode;
  /** A pictogram drawn before the text. */
  readonly icon?: ReactNode;
}) {
  const attrs = useLocaleAttrs();
  return (
    <div
      {...attrs}
      role="status"
      className="flex items-start gap-3 rounded-sign border border-edge border-s-3 border-s-ink-2 bg-panel px-4 py-3 text-base text-ink-2"
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

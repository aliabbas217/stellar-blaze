import { useTranslations } from "next-intl";
import { LevelMark } from "@/components/level/LevelSign";
import type { Level } from "@/components/level/level";
import { Link } from "@/i18n/navigation";
import { ACTION_PRIMARY, ACTION_SECONDARY } from "./actions";
import { isDeferredRoute } from "./deferred-routes";

export interface EmptyAction {
  readonly label: string;
  /** A route of the app, without a locale prefix ("/worker/alerts"). Never a deferred view. */
  readonly href: string;
}

export interface EmptyStateProps {
  readonly title: string;
  /** Why there is nothing here, in one sentence a worker can act on. */
  readonly reason: string;
  readonly primary: EmptyAction;
  readonly secondary?: EmptyAction;
  /** The level that still applies while the list is empty (a crew with no shift still has a site level). */
  readonly level?: Level;
}

function assertLive(action: EmptyAction): void {
  if (isDeferredRoute(action.href)) {
    // A programming error, caught in development and in the unit tests: an empty state that links to a parked view is a dead end.
    throw new Error(`EmptyState: "${action.label}" links to a deferred view (${action.href})`);
  }
}

/**
 * What a screen shows when there is nothing to list. Actionable by construction: a title, the reason, and a primary
 * link that goes somewhere that exists. It is never blank and never a dead end (journeys, states).
 */
export function EmptyState({ title, reason, primary, secondary, level }: EmptyStateProps) {
  const t = useTranslations("levels");
  assertLive(primary);
  if (secondary !== undefined) assertLive(secondary);

  return (
    <section className="flex flex-col items-start gap-3 rounded-sign border border-dashed border-edge px-6 py-8">
      {level === undefined ? null : (
        <p className="flex items-center gap-2 text-base text-ink-2">
          <LevelMark level={level} />
          <span>{t(`name.${level}`)}</span>
        </p>
      )}
      <h2 className="font-display text-lg font-medium">{title}</h2>
      <p className="max-w-(--measure) text-base text-ink-2">{reason}</p>
      <div className="flex flex-wrap gap-3">
        <Link href={primary.href} className={ACTION_PRIMARY}>
          {primary.label}
        </Link>
        {secondary === undefined ? null : (
          <Link href={secondary.href} className={ACTION_SECONDARY}>
            {secondary.label}
          </Link>
        )}
      </div>
    </section>
  );
}

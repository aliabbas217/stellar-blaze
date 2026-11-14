import { useTranslations } from "next-intl";
import { LevelMark } from "@/components/level/LevelSign";
import type { Level } from "@/components/level/level";
import { FieldLink } from "@/components/shell/FieldLink";
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

/**
 * An action that links to a parked view is a programming error. In development and under test it throws, so it is
 * caught before it ships. In production it is dropped instead: an empty state sits on safety screens, and a thrown
 * render there would blank the whole screen, which is worse than a missing button.
 */
function usable(action: EmptyAction | undefined): EmptyAction | null {
  if (action === undefined || !isDeferredRoute(action.href)) return action ?? null;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(`EmptyState: "${action.label}" links to a deferred view (${action.href})`);
  }
  return null;
}

/**
 * What a screen shows when there is nothing to list. Actionable by construction: a title, the reason, and a primary
 * link that goes somewhere that exists. It is never blank and never a dead end (journeys, states).
 */
export function EmptyState({ title, reason, primary, secondary, level }: EmptyStateProps) {
  const t = useTranslations("levels");
  const main = usable(primary);
  const other = usable(secondary);

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
      {main === null && other === null ? null : (
        <div className="flex flex-wrap gap-3">
          {main === null ? null : (
            <FieldLink href={main.href} className={ACTION_PRIMARY}>
              {main.label}
            </FieldLink>
          )}
          {other === null ? null : (
            <FieldLink href={other.href} className={main === null ? ACTION_PRIMARY : ACTION_SECONDARY}>
              {other.label}
            </FieldLink>
          )}
        </div>
      )}
    </section>
  );
}

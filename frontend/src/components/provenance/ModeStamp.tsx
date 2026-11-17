import { Stamp } from "@/components/provenance/Stamp";
import { Skeleton } from "@/components/states/Skeletons";
import type { components } from "@/api/schema";

/*
 * The stamp every screen that shows forecast data carries when the API served a replayed day (`mode: "replay"`, review
 * focus 6): a replay must never be mistaken for a live forecast. Live data carries no stamp. The mode is read from the
 * response, never from the environment: only the API knows what it served.
 */

type Mode = components["schemas"]["SiteForecastToday"]["mode"];

/**
 * The Replay stamp itself, for a place that already has room for it (the kicker line of a level sign): nothing for live, or for a
 * screen that has no response yet. Small and quiet: it labels the evidence, it is never a primary element.
 */
export function ModeStamp({ mode }: { readonly mode: Mode | null }) {
  return mode === "replay" ? (
    <span data-mode-stamp="" className="inline-flex">
      <Stamp kind="REPLAY" />
    </span>
  ) : null;
}

/** The stamp in a row of its own, for a screen with no sign to put it beside (the supervisor crews). `className` is the row's gutter. */
export function ModeStampRow({ mode, className = "px-4" }: { readonly mode: Mode | null; readonly className?: string }) {
  return mode === "replay" ? (
    <div className={className}>
      <ModeStamp mode={mode} />
    </div>
  ) : null;
}

/** The room the row takes (one 24 px stamp), for a skeleton that stands in for a screen that carries it. */
export function ModeStampSkeleton() {
  return <Skeleton height="1.5rem" width="5rem" />;
}

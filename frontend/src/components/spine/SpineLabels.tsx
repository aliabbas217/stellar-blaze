import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { BanState } from "./ban-state";
import { formatClock, labelPlacement, pct, percentAt, screenPercent, tickHours, type Dir, type Orientation } from "./geometry";

/*
 * The spine's text. Labels are HTML on the same percentage coordinates as the SVG, not SVG text in a scaled viewBox:
 * a label's size is a type token (16 px on a field surface, never scaled by the width the spine is drawn at), it wraps
 * and takes the locale's line height (Nastaliq is never clipped), and the waypoints are real text outside the image
 * the cells are, so a screen reader reads them. Clock times are Western digits, left to right, in every locale.
 */

export interface SpineWaypoint {
  /** Hour of the day, fractional (11.1667 is 11:10). */
  readonly at: number;
  readonly title?: string;
  readonly detail?: string;
}

interface AxisProps {
  readonly orientation: Orientation;
  readonly dir: Dir;
  readonly from: number;
  readonly to: number;
}

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

/** Hour ticks. Decorative (the spine's label names its span); drawn left to right whatever the direction. */
export function SpineTicks({ orientation, dir, from, to, coarse = false }: AxisProps & { readonly coarse?: boolean }) {
  return (
    <>
      {tickHours(from, to, coarse).map((hour) => {
        const p = percentAt(hour, from, to);
        const at = pct(screenPercent(p, orientation, dir));
        return (
          <span
            key={hour}
            data-tick={hour}
            dir="ltr"
            aria-hidden="true"
            style={orientation === "v" ? { top: `${at}%` } : { left: `${at}%` }}
            className={`absolute font-medium leading-solid text-ink-2 text-(length:--spine-tick) ${
              orientation === "v" ? "end-0 -translate-y-1/2" : "top-0 -translate-x-1/2"
            }`}
          >
            {formatClock(hour)}
          </span>
        );
      })}
    </>
  );
}

function Lines({ title, detail }: { readonly title?: string | undefined; readonly detail?: string | undefined }) {
  return (
    <>
      {title === undefined ? null : <p className="font-medium text-ink">{title}</p>}
      {detail === undefined ? null : <p className="text-ink-2">{detail}</p>}
    </>
  );
}

/**
 * The waypoints as a list. Vertical: each sits at its time in the label column, a short rule at its time and the text
 * beside it. Horizontal: each is centred over its time (held inside the track at the ends), stacked above the band.
 */
export function SpineWaypoints({ waypoints, orientation, dir, from, to }: AxisProps & { readonly waypoints: readonly SpineWaypoint[] }) {
  const shown = waypoints.filter((w) => w.title !== undefined || w.detail !== undefined);
  if (shown.length === 0) return null;
  if (orientation === "v") {
    return (
      <ol className="absolute inset-0 m-0 list-none p-0">
        {shown.map((w) => (
          <li
            key={`${String(w.at)}-${w.title ?? ""}`}
            data-waypoint=""
            style={{ top: `${pct(percentAt(w.at, from, to))}%`, transform: "translateY(calc(var(--spine-row) / -2))" }}
            className="absolute inset-x-0 flex items-start gap-2"
          >
            <span aria-hidden="true" className="mt-[calc(var(--spine-row)/2)] w-3 shrink-0 border-t border-ink" />
            <div className="min-w-0">
              <Lines title={w.title} detail={w.detail} />
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return (
    // dir="ltr" on the list so a label's static position is the physical left edge, from which `left: N%` is measured
    // (the mirrored percentage is already physical); each label sets its own text direction
    <ol dir="ltr" className="m-0 flex list-none flex-col p-0">
      {shown.map((w) => {
        const p = screenPercent(percentAt(w.at, from, to), orientation, dir);
        return (
          <li
            key={`${String(w.at)}-${w.title ?? ""}`}
            data-waypoint=""
            dir={dir}
            style={{ left: `${pct(p)}%`, top: 0, transform: `translateX(${labelPlacement(p).shift})`, maxWidth: labelPlacement(p).maxWidth }}
            className="relative w-max text-center"
          >
            <Lines title={w.title} detail={w.detail} />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The slot's one label: "Midday break" with its hours where the break is in force; "Midday break by law: not in force
 * until 15 Jun" where it is not and the surface is a desk. A field surface out of season shows nothing.
 */
export function SlotLabel({
  ban,
  surface,
  orientation,
  dir,
  from,
  to,
}: AxisProps & { readonly ban: BanState; readonly surface: "field" | "desk" }) {
  const t = useTranslations("common.spine");
  if (ban.kind === "not-in-force" && surface === "field") return null;

  const mid = ban.kind === "in-force" ? (ban.fromHour + ban.toHour) / 2 : ban.outline === null ? null : (ban.outline.fromHour + ban.outline.toHour) / 2;
  const body =
    ban.kind === "in-force" ? (
      <>
        <p className="font-medium text-ink">{t("slotTitle")}</p>
        <p className="text-ink-2">
          {t.rich("slotRange", { from: formatClock(ban.fromHour), to: formatClock(ban.toHour), bdi })}
        </p>
      </>
    ) : (
      <p className="text-ink-2">
        {ban.resumesLabel === null ? t("outlineNoDate") : t.rich("outline", { date: ban.resumesLabel, bdi })}
      </p>
    );

  if (orientation === "v") {
    // centred on the slot (or its outline), so it never collides with a waypoint at one of the edges
    const top = mid === null ? 0 : percentAt(mid, from, to);
    return (
      <div
        data-slot-label=""
        style={{ top: `${pct(top)}%`, transform: mid === null ? "none" : "translateY(-50%)" }}
        className="absolute inset-x-0 ps-5"
      >
        {body}
      </div>
    );
  }
  const p = mid === null ? 50 : screenPercent(percentAt(mid, from, to), orientation, dir);
  return (
    <div dir="ltr">
      <div
        data-slot-label=""
        dir={dir}
        style={{ left: `${pct(p)}%`, transform: `translateX(${labelPlacement(p).shift})`, maxWidth: labelPlacement(p).maxWidth }}
        className="relative w-max text-center"
      >
        {body}
      </div>
    </div>
  );
}

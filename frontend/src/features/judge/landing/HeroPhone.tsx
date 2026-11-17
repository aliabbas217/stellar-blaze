import { useTranslations } from "next-intl";
import { LevelSign } from "@/components/level/LevelSign";
import { Pictogram } from "@/components/level/Pictogram";
import { TimeSpine, type BanState } from "@/components/spine/TimeSpine";
import { ACTION_STOP } from "@/components/states/actions";

/*
 * The phone sign of the hero: what a worker's phone shows, built from the app's own presentational components (the level sign, the time
 * spine, the pictograms, the Stop tier of the control system) with STATIC demo props. It is a picture of the product, never a reading: it is
 * `aria-hidden` and `inert` (nothing in it is a control; its words are the caption's), and it is labelled "Demo" on the glass, because the
 * level, the clock and the cycle are made up for the picture, exactly as the demo site and its crews are.
 *
 *   - the work and rest minutes are the demo prop `cycle`: the judge pages may not import worker code (ADR 0009 section 7), so the app's own parser of the
 *     action code `cycle.high.heavy.20-40` is not called here; tests/unit/features/judge/landing/landing.test.tsx asserts the two agree;
 *   - the colours of the day strip are the recorded forecast of the field's own day (the same 24 hourly values as the hour scrubber under the
 *     field), hours 6 to 17 of it, so the strip is data, not decoration;
 *   - the sign, the lead, the strip, the Stop-tier slab and the words come out in the page's language (messages worker.*, levels.*).
 * The clock and the level are the picture's, not claims: the caption says it is a demo.
 */

/** The picture's own moment: a morning on site (not a reading, not a forecast). */
const DEMO = { level: "orange", now: 10.25, until: "17:00", cycle: { work: 20, rest: 40 }, from: 6, to: 18 } as const;

const clock = (hour: number): string => {
  const whole = Math.floor(hour);
  return `${String(whole).padStart(2, "0")}:${String(Math.round((hour - whole) * 60)).padStart(2, "0")}`;
};

export interface HeroPhoneProps {
  /** The field day's 24 hourly values (recorded forecast): the colours of the strip. */
  readonly omaa: readonly number[];
  readonly ban: BanState;
  readonly dir: "ltr" | "rtl";
}

export function HeroPhone({ omaa, ban, dir }: HeroPhoneProps) {
  const t = useTranslations("judge.landing.phone");
  const today = useTranslations("worker.today");
  const nav = useTranslations("worker.nav");
  const lead = today("lead.cycle", { work: String(DEMO.cycle.work), rest: String(DEMO.cycle.rest) });
  const cells = omaa.map((wbgtC, hour) => ({ hour, wbgtC })).filter((cell) => cell.hour >= DEMO.from && cell.hour < DEMO.to);

  return (
    <figure data-hero-phone="" className="grid justify-items-center gap-3">
      <div
        aria-hidden="true"
        // `inert`: React 19 passes the boolean through. Nothing in the picture can take focus or be clicked.
        inert
        className="grid w-full max-w-72 gap-4 rounded-card bg-panel p-4 inset-ring-[1.5px] inset-ring-edge"
      >
        <div className="flex items-center justify-between gap-2 text-sm text-ink-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{t("site")}</span>
            <span className="flex-none rounded-ctl px-1.5 py-0.5 text-xs font-semibold tracking-wide text-ink-2 uppercase inset-ring-[1.5px] inset-ring-edge">{t("demo")}</span>
          </span>
          <span className="flex-none font-semibold text-ink tabular-nums">{clock(DEMO.now)}</span>
        </div>
        <LevelSign
          level={DEMO.level}
          kind="live"
          size="hero"
          kicker={today("kicker.site")}
          until={today.rich("until", { time: DEMO.until, bdi: (chunks) => <bdi>{chunks}</bdi> })}
        />
        <p className="grid grid-cols-[2.5rem_1fr] items-center gap-3 text-lg leading-(--sign-leading-text) font-medium text-ink">
          <Pictogram name="shade" className="size-10" />
          <span>{lead}</span>
        </p>
        <TimeSpine orientation="h" from={DEMO.from} to={DEMO.to} cells={cells} now={DEMO.now} ban={ban} surface="field" dir={dir} aria={t("caption")} />
        <div className={`${ACTION_STOP} pointer-events-none`}>
          <Pictogram name="cross" className="size-5" />
          <span>{nav("unwell")}</span>
        </div>
      </div>
      <figcaption data-contrast="body" data-contrast-name="phone-caption" className="max-w-72 text-center text-sm text-ink-2">
        {t("caption")}
      </figcaption>
    </figure>
  );
}

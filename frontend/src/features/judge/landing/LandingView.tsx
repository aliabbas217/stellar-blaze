import { useLocale, useTranslations } from "next-intl";
import { dayFormat } from "@/components/charts/day-format";
import { FieldLink } from "@/components/shell/FieldLink";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { makeFormat } from "@/features/judge/adapters";
import type { EvalData } from "@/features/judge/data";
import { LIMIT_C } from "./field-data";
import type { FieldHeroData } from "./field-server";
import { buildEvidence } from "./evidence";
import { ForecastStage } from "./ForecastStage";
import { CLASS_STEPS, LEGEND_SWATCHES } from "./landing-colour";
import { LandingEffects } from "./LandingEffects";
import { LandingRail } from "./LandingRail";
import { Boundary, EvidenceSlides, Limits, Morning, Plan, WaysIn } from "./LandingSlides";
import { STATIONS } from "./landing-stations";
import "@/styles/landing.css";

/*
 * The landing page, "Real Earth" (redesign S10, ported from the approved prototype): a chapter rail on the start edge and seven chapters.
 *   01 Forecast   the hero and ONE pinned scene share one stage: a real satellite-and-terrain slab of the UAE with the recorded ECMWF IFS day-1
 *                 forecast on it as flat amber classes; scrolling moves the hour 06:00 to 14:00, the camera and three captions (ForecastStage.tsx)
 *   02 Morning    03 Plan    04 Boundary    05 Evidence (two screens)    06 Ways in    07 Limits: one whole screen each, coming to rest on wide
 *                 screens (landing.css); a plain column everywhere else.
 * A server component over build-time files: nothing here fetches and every number on it is read from a committed file by the code imported here,
 * never typed: the bars, the axis and the two big verdict numbers from the scored Warnings file (evidence.ts), the captions and the legend from the
 * recorded forecast and the field's limit (field-data.ts). Claim rules this page keeps: no win claim (the regulator's zones raise fewer false
 * alarms, and the second evidence screen says so), the map is an illustration of one hot day and not the day that was scored, and the limits last.
 * The page is drawn with the night tokens whatever theme the visitor has: it is an instrument page, and tokens.css sets sun mode on field routes only.
 */

export interface LandingViewProps {
  readonly field: FieldHeroData;
  /** What the scored-file loader found; null when it failed or there is none. */
  readonly data: EvalData | null;
  readonly dir: "ltr" | "rtl";
}

export function LandingView({ field, data, dir }: LandingViewProps) {
  const t = useTranslations("judge.landing");
  const ts = useTranslations("judge.scoreboard");
  const locale = useLocale();
  const f = dayFormat(locale);
  const day = field.grid.day;
  const year = day.slice(0, 4);
  const dayLabel = `${f.withWeekday(day)} ${year}`;
  const dateLabel = `${f.dayMonth(day)} ${year}`;
  const evidence = buildEvidence(data, makeFormat(locale), ts);
  const stations = STATIONS.map((s) => ({ ...s, name: t(`field.stations.${s.code}`) }));
  const limit = LIMIT_C.toFixed(1);

  const hero = (
    <>
      <h1 id="h1" data-contrast="large" data-contrast-name="h1">
        {t("title")}
      </h1>
      <p className="lede" data-contrast="body" data-contrast-name="lede">
        {t("lede")}
      </p>
      <p className="act">
        <a className="btn" href="#morning">
          {t("hero.primary")}
        </a>
        <a className="quiet" href="#ways">
          {t("hero.skip")}
        </a>
      </p>
    </>
  );
  const legend = (
    <div className="legend">
      <p className="k">{t("scene.limit", { limit })}</p>
      <div className="chips" aria-hidden="true">
        {LEGEND_SWATCHES.map((background, i) => (
          <i key={i} style={{ background }} />
        ))}
      </div>
      <div className="chl" aria-hidden="true">
        {[t("scene.legendNone"), ...CLASS_STEPS.map((v, i) => (i === 0 ? limit : String(v)))].map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="lp" data-theme="night" data-landing="">
      <FieldLink
        href="/replay"
        className="sr-only rounded-sign bg-ink px-4 py-3 text-base font-medium text-ground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skip")}
      </FieldLink>
      <LandingRail>
        <div className="lang">
          <LocaleSwitcher />
        </div>
        <MachineTranslationNotice className="mt" />
      </LandingRail>
      <main id="main-content">
        <ForecastStage
          region={t("field.region", { day: dayLabel })}
          when={t("field.scrubber.when", { day: dayLabel })}
          dateLabel={dateLabel}
          omaa={field.omaa}
          rtl={dir === "rtl"}
          sourceLine={t("scene.source", { date: dateLabel })}
          hero={hero}
          legend={legend}
          attribution={field.attribution}
          stations={stations}
        />
        <Morning omaa={field.omaa} />
        <Plan />
        <Boundary />
        <EvidenceSlides evidence={evidence} />
        <WaysIn />
        <Limits />
      </main>
      <LandingEffects />
    </div>
  );
}

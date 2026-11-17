import { useLocale, useTranslations } from "next-intl";
import { dayFormat } from "@/components/charts/day-format";
import { proofFromStaticFile } from "@/components/provenance/proof";
import { buildStory } from "@/components/provenance/proof-story";
import { FieldLink } from "@/components/shell/FieldLink";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { StoryNav } from "@/components/shell/StoryNav";
import { makeFormat } from "@/features/judge/adapters";
import { banStateFor, SEASON_BAN } from "@/features/judge/ban";
import type { EvalData } from "@/features/judge/data";
import { readingAt } from "./field-data";
import type { FieldHeroData } from "./field-server";
import { FieldGate } from "./FieldGate";
import { FieldPoster, type FieldPanelProps } from "./FieldPoster";
import { buildEvidence } from "./evidence";
import { HeroPhone } from "./HeroPhone";
import { Chapters } from "./LandingChapters";
import { LandingHeader } from "./LandingHeader";
import { RoleDoor } from "./RoleDoor";

/*
 * The landing page: a story in the order of the build plan (redesign S2, A2), promise, person, product, then the evidence as the payoff.
 *
 *   1. the hero: the promise (the h1 and its lede), the ROLE DOOR (four tiles, the way in for each kind of visitor), a phone sign built from
 *      the app's own components with demo props, and the 3D heat field beside it with its caption (D7). The field is a box of its own, not
 *      the backdrop of the page: it is drawn from the recorded forecast grid after first paint (FieldGate), the poster is the server's
 *      loading state, and the old six-line readout and the statistic that led the page are gone.
 *   2. the chapters (LandingChapters.tsx): a morning on site, tonight's plan, the boundary, last summer replayed, what this does not show yet.
 *   3. the foot: the story footer (Back and Next) and the machine-translation notice.
 *
 * A server component over build-time files: nothing here fetches, and every number on it is read from a committed file by the code that is
 * imported here (never typed): the four bars and their sentences from the scored Warnings file (evidence.ts), the phone's day strip and the field
 * from the recorded forecast. Claim rules this page keeps: no win claim (the regulator's zones raise fewer false alarms, and the sentence under
 * the bars says so), no probability, "tested on summer 2026, every setting chosen on 2024 and 2025 data", and the limits stated last.
 * The unledgered season counts of the old chapter 1 are not on this page (they live behind a number's "Where from" chip only).
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
  const format = makeFormat(locale);
  const f = dayFormat(locale);

  // ---- the field of the hero ----
  const day = field.grid.day;
  const dayLabel = `${f.withWeekday(day)} ${day.slice(0, 4)}`;
  const ban = banStateFor(SEASON_BAN, day, locale);
  const panel: FieldPanelProps = {
    day,
    dayLabel,
    omaa: field.omaa,
    peakHour: field.peakHour,
    ban,
    // The file's own words are the proof's protocol and script (it says plainly that this day is an illustration, not the scored day).
    proof: proofFromStaticFile(field.file, t("field.proofWhat", { day: dayLabel }), {
      story: buildStory("field", { day }),
      protocol: field.grid.why,
      script: field.grid.physics,
      label: "RECORDED",
    }),
    dir,
  };
  const reading = readingAt(field.grid, field.omaa, field.peakHour);
  const evidence = buildEvidence(data, format, ts);

  return (
    <>
      <FieldLink
        href="/replay"
        className="sr-only rounded-sign bg-ink px-4 py-3 text-base font-medium text-ground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t("skip")}
      </FieldLink>

      <LandingHeader />

      <main id="main-content" className="flex flex-col">
        <section aria-labelledby="landing-title" data-landing-hero="" className="border-b border-hair">
          <div className="mx-auto grid w-full max-w-(--content-max) gap-10 px-4 py-8 sm:px-6 min-[1100px]:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] min-[1100px]:items-center min-[1100px]:gap-12 min-[1100px]:px-10 min-[1100px]:py-14">
            <div className="grid content-start gap-5">
              <p data-contrast="body" data-contrast-name="kicker" className="text-sm text-ink-3">{t("kicker")}</p>
              <h1
                id="landing-title"
                data-contrast="large"
                data-contrast-name="h1"
                className="font-display text-4xl leading-(--sign-leading-display) font-normal tracking-display min-[1100px]:text-5xl min-[1100px]:rtl:text-4xl"
              >
                {t("title")}
              </h1>
              <p data-contrast="body" data-contrast-name="lede" className="max-w-[44ch] text-lg text-ink-2">{t("lede")}</p>
              <RoleDoor className="mt-1" />
              <p data-contrast="body" data-contrast-name="door-note" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                <span className="rounded-ctl px-1.5 py-0.5 text-xs font-semibold tracking-wide text-ink-2 uppercase inset-ring-[1.5px] inset-ring-edge">{t("phone.demo")}</span>
                <span className="min-w-0 flex-1 basis-56">{t("door.note")}</span>
              </p>
            </div>
            <div data-hero="" className="grid items-start gap-8 min-[640px]:grid-cols-[18rem_minmax(0,1fr)] min-[1100px]:gap-6">
              <HeroPhone omaa={field.omaa} ban={ban} dir={dir} />
              <div data-field-column="" className="grid min-w-0 content-start gap-3">
                <FieldGate panel={panel}>
                  <FieldPoster panel={panel} grid={field.grid} reading={reading} />
                </FieldGate>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-24 px-4 pt-16 pb-12 sm:px-6 min-[900px]:px-10">
          <Chapters evidence={evidence} />

          <StoryNav current="problem" />

          {/* The foot of the page, below everything: the one quiet line of a machine-translated catalogue (architect ruling 2026-11-15). */}
          <MachineTranslationNotice />
        </div>
      </main>
    </>
  );
}

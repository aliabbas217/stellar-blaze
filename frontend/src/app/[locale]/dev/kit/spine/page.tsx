import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LocaleSwitcher } from "@/components/shell/LocaleSwitcher";
import { ScreenColors } from "@/components/shell/ScreenColors";
import { banStateFrom, type BanWindowInput } from "@/components/spine/ban-state";
import { TimeSpine, type SpineCell, type SpineWaypoint } from "@/components/spine/TimeSpine";
import { dirFor } from "@/i18n/direction";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { Cell, CellGrid } from "../sections/Cell";

/*
 * Dev-only gallery of the time spine (plan F2 Task 5): both orientations on both surfaces, with the midday break in
 * force and out of season, plus the no-data and mixed-hours cases. Like the other dev pages it returns 404 in
 * production unless SB_SPECIMEN=1. The sun toggle swaps the theme and the language switcher the direction (Arabic and
 * Urdu), so the one page checks both themes and both directions.
 *
 * The ban windows are the generated BanWindow shape (frozen B3 v1), run through banStateFrom, so the slot is drawn
 * from instants exactly as the screens will. The WBGT values are a specimen day, not data from the API.
 */

const TZ = "Asia/Dubai";
const IN_SEASON: BanWindowInput = {
  active_on_date: true,
  start: "12:30",
  end: "15:00",
  starts_at: "2026-09-03T08:30:00Z",
  ends_at: "2026-09-03T11:00:00Z",
  season_start: "06-15",
  season_end: "09-15",
  timezone: TZ,
};
const OUT_OF_SEASON: BanWindowInput = { ...IN_SEASON, active_on_date: false, starts_at: null, ends_at: null };

// A specimen day, 06:00 to 17:00, WBGT in degrees C.
const SPECIMEN = [27.4, 29.1, 31.2, 33.4, 35.2, 36.9, 38.1, 39.2, 39.4, 38.6, 36.8, 34.2];
const CELLS: readonly SpineCell[] = SPECIMEN.map((wbgtC, i) => ({ hour: 6 + i, wbgtC }));
const MIXED: readonly SpineCell[] = CELLS.map((c) => (c.hour === 10 || c.hour === 11 ? { hour: c.hour, wbgtC: null } : c));
const EMPTY: readonly SpineCell[] = CELLS.map((c) => ({ hour: c.hour, wbgtC: null }));
const NOW = 11 + 10 / 60;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.spineKit");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function SpineKitPage(props: PageProps<"/[locale]/dev/kit/spine">) {
  // Opt into request-time rendering so SB_SPECIMEN is read per request, not frozen at build.
  await connection();
  if (process.env.NODE_ENV === "production" && process.env.SB_SPECIMEN !== "1") notFound();

  const { locale } = await props.params;
  const dir = dirFor(locale as Locale);
  const t = await getTranslations("common.spineKit");
  const inForce = banStateFrom(IN_SEASON, TZ, "2026-09-03", locale);
  const outOfSeason = banStateFrom(OUT_OF_SEASON, TZ, "2026-11-14", locale);
  const waypoints: readonly SpineWaypoint[] = [
    { at: NOW, title: t("sample.now"), detail: "11:10" },
    { at: 18, title: t("sample.shiftEnd"), detail: "18:00" },
  ];

  const common = { from: 6, to: 18, dir, transitionName: null, aria: "Hour cells, 06:00 to 18:00" } as const;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 font-body" data-testid="spine-kit">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-sm text-ink-3">{t("kicker", { locale })}</p>
        <h1 className="font-display text-5xl leading-solid tracking-display">{t("title")}</h1>
        <p className="max-w-(--measure) text-lg text-ink-2">{t("lead")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <LocaleSwitcher />
          <ScreenColors />
          <Link href="/dev/kit" className="inline-flex min-h-(--target) items-center text-base text-ink-2 underline">
            {t("back")}
          </Link>
        </div>
      </header>

      <section aria-labelledby="spine-field" className="flex flex-col gap-4">
        <h2 id="spine-field" className="border-b border-hair pb-2 font-display text-2xl font-medium">
          field
        </h2>
        <CellGrid>
          <Cell caption="field · vertical · in force (12:30 to 15:00 from the window)" testId="spine-field-v-in">
            <TimeSpine {...common} orientation="v" surface="field" cells={CELLS} now={NOW} ban={inForce} waypoints={waypoints} />
          </Cell>
          <Cell caption="field · vertical · out of season (no slot)" testId="spine-field-v-out">
            <TimeSpine {...common} orientation="v" surface="field" cells={CELLS} now={NOW} ban={outOfSeason} waypoints={waypoints} />
          </Cell>
          <Cell caption="field · vertical · hours without data (hair, not ramp)" testId="spine-field-v-mixed">
            <TimeSpine {...common} orientation="v" surface="field" cells={MIXED} now={NOW} ban={inForce} waypoints={waypoints} />
          </Cell>
          <Cell caption="field · horizontal · in force" wide testId="spine-field-h-in">
            <TimeSpine {...common} orientation="h" surface="field" cells={CELLS} now={NOW} ban={inForce} waypoints={waypoints} />
          </Cell>
          <Cell caption="field · horizontal · out of season (no slot)" wide testId="spine-field-h-out">
            <TimeSpine {...common} orientation="h" surface="field" cells={CELLS} now={NOW} ban={outOfSeason} waypoints={waypoints} />
          </Cell>
        </CellGrid>
      </section>

      <section aria-labelledby="spine-desk" className="flex flex-col gap-4">
        <h2 id="spine-desk" className="border-b border-hair pb-2 font-display text-2xl font-medium">
          desk
        </h2>
        <CellGrid>
          <Cell caption="desk · vertical · in force" testId="spine-desk-v-in">
            <TimeSpine {...common} orientation="v" surface="desk" cells={CELLS} now={NOW} ban={inForce} waypoints={waypoints} />
          </Cell>
          <Cell caption="desk · vertical · out of season (dashed, labelled outline)" testId="spine-desk-v-out">
            <TimeSpine {...common} orientation="v" surface="desk" cells={CELLS} now={NOW} ban={outOfSeason} waypoints={waypoints} />
          </Cell>
          <Cell caption="desk · vertical · no forecast at all" testId="spine-desk-v-empty">
            <TimeSpine {...common} orientation="v" surface="desk" cells={EMPTY} now={null} ban={inForce} />
          </Cell>
          <Cell caption="desk · horizontal · in force" wide testId="spine-desk-h-in">
            <TimeSpine {...common} orientation="h" surface="desk" cells={CELLS} now={NOW} ban={inForce} waypoints={waypoints} />
          </Cell>
          <Cell caption="desk · horizontal · out of season (dashed, labelled outline)" wide testId="spine-desk-h-out">
            <TimeSpine {...common} orientation="h" surface="desk" cells={CELLS} now={NOW} ban={outOfSeason} waypoints={waypoints} />
          </Cell>
        </CellGrid>
      </section>
    </main>
  );
}

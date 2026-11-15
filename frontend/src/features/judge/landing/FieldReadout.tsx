import { useTranslations } from "next-intl";
import { ProofChip } from "@/components/provenance/ProofChip";
import type { Proof } from "@/components/provenance/proof";
import { hourLabel, LIMIT_C, type FieldReading } from "./field-data";

/*
 * The readout: every reading the canvas shows, as text. Hottest grid cell of the forecast at the selected hour, the station's
 * own value, the heavy-work limit, how many grid cells are above it, and where the numbers come from (with its proof chip).
 * Presentational and hook-free apart from the message hook, so the server states it in the first HTML at the peak hour and the
 * island states it live with the same code.
 *
 * `live`: the live region is ONE short sentence (hour, hottest grid cell, airport), not the whole card: an arrow press would
 * otherwise read about eight nodes. While the day plays it is silent (a number read aloud every second is noise); at rest it is
 * `polite`, so a reader who moves the slider hears the new reading. The card itself stays ordinary text a reader can browse.
 */

export interface ReadoutText {
  readonly hour: string;
  readonly hottest: string;
  readonly lat: string;
  readonly lon: string;
  readonly station: string;
  readonly limit: string;
  readonly cells: string;
  readonly cellsTotal: string;
}

/** The strings of one reading: one decimal for temperatures, two for coordinates, Western digits in every language. */
export function readoutText(reading: FieldReading): ReadoutText {
  return {
    hour: hourLabel(reading.hour),
    hottest: reading.hottest.value.toFixed(1),
    lat: reading.hottest.lat.toFixed(2),
    lon: reading.hottest.lon.toFixed(2),
    station: reading.station.toFixed(1),
    limit: LIMIT_C.toFixed(1),
    cells: String(reading.cellsAbove),
    cellsTotal: String(reading.cells),
  };
}

export interface FieldReadoutProps {
  readonly reading: FieldReading;
  /** The note about the day and what the field is; its words come from the server's choice (peak of the season or plain). */
  readonly source: string;
  readonly proof: Proof;
  readonly live: boolean;
  /** The sentence the live region says: hour, hottest grid cell and airport (the same words as the slider's value text). */
  readonly announce: string;
}

export function FieldReadout({ reading, source, proof, live, announce }: FieldReadoutProps) {
  const t = useTranslations("judge.landing.field");
  const text = readoutText(reading);
  return (
    <aside
      aria-label={t("readout")}
      data-field-readout=""
      className="relative z-10 grid gap-2 rounded-sign border border-hair bg-ground/90 p-4 min-[900px]:absolute min-[900px]:end-10 min-[900px]:bottom-36 min-[900px]:w-80 max-[899px]:order-4 max-[899px]:mx-4"
    >
      <p className="sr-only" aria-live={live ? "polite" : "off"} data-readout-live="">
        {announce}
      </p>
      <p className="text-sm text-ink-3">{t("hottest", { hour: text.hour })}</p>
      <p className="font-display text-4xl leading-solid font-light tracking-display tabular-nums text-ink" data-readout-hottest="">
        {text.hottest}
        <small className="ms-1 text-lg font-normal text-ink-2">{t("degrees")}</small>
      </p>
      <p className="text-sm text-ink-3 tabular-nums" data-readout-where="">
        {t("where", { lat: text.lat, lon: text.lon })}
      </p>
      <dl className="mt-1 grid grid-cols-[1fr_auto] border-t border-hair text-sm">
        <dt className="border-b border-hair py-2 text-ink-2">{t("station")}</dt>
        <dd className="border-b border-hair py-2 text-end tabular-nums text-ink" data-readout-station="">
          {text.station} {t("degrees")}
        </dd>
        <dt className="border-b border-hair py-2 text-ink-2">{t("limit")}</dt>
        <dd className="border-b border-hair py-2 text-end tabular-nums text-ink">
          {text.limit} {t("degrees")}
        </dd>
        <dt className="border-b border-hair py-2 text-ink-2">{t("cells")}</dt>
        <dd className="border-b border-hair py-2 text-end tabular-nums text-ink" data-readout-cells="">
          {t("cellsOf", { n: text.cells, total: text.cellsTotal })}
        </dd>
      </dl>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs leading-snug text-ink-3">{source}</p>
        <ProofChip proof={proof} />
      </div>
    </aside>
  );
}

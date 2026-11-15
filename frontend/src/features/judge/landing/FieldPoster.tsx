import { useTranslations } from "next-intl";
import type { CSSProperties, ReactNode } from "react";
import type { Proof } from "@/components/provenance/proof";
import type { BanState } from "@/components/spine/TimeSpine";
import { heatColor } from "@/lib/heat/ramp";
import { boxOf, type FieldGrid, type FieldReading } from "./field-data";
import { FieldReadout, readoutText } from "./FieldReadout";
import { FieldStage } from "./FieldStage";
import { HourScrubber } from "./HourScrubber";

/*
 * What the server paints before the island is in: the stage (empty, at its final size), the readout at the peak hour (real
 * numbers, read from the recorded files on the server) and the spine of the day with no slider yet. It is the loading state:
 * the island replaces it box for box, so nothing moves. `FieldIsland` draws the same three parts.
 */

export interface FieldPanelProps {
  readonly day: string;
  readonly dayLabel: string;
  readonly omaa: readonly number[];
  readonly peakHour: number;
  readonly ban: BanState;
  readonly proof: Proof;
  /** Whether the day is the summer's highest daily peak of the raw forecast (the source line says so only then). */
  readonly highestOfSeason: boolean;
  readonly dir: "ltr" | "rtl";
}

/**
 * The field at the peak hour as a blurred picture of the grid cells (real data, 17 x 22 cells), in the box the canvas will draw
 * the sharp field in: a container-query layout that reproduces `geometry()` of field-draw.ts (half the width or 62 % of the
 * height on a wide screen, 92 % and 86 % on a phone), so the island's canvas replaces it where it stands.
 */
function PosterMap({ grid, hour }: { readonly grid: FieldGrid; readonly hour: number }) {
  const rows = grid.lat.length;
  const cols = grid.lon.length;
  const [west, south, east, north] = boxOf(grid);
  const aspect = ((east - west) * Math.cos((((south + north) / 2) * Math.PI) / 180)) / (north - south);
  const base = hour * rows * cols;
  const cells: ReactNode[] = [];
  for (let row = 0; row < rows; row++) {
    const i = rows - 1 - row; // north first
    for (let j = 0; j < cols; j++) {
      const value = grid.values[base + i * cols + j] ?? 0;
      cells.push(<rect key={`${String(row)}-${String(j)}`} x={j} y={row} width={1.02} height={1.02} fill={heatColor(Math.round(value * 2) / 2, "night")} />);
    }
  }
  return (
    <div className="absolute inset-0 [container-type:size]" data-poster-map="">
      <svg
        viewBox={`0 0 ${String(cols)} ${String(rows)}`}
        preserveAspectRatio="none"
        style={{ "--ar": String(aspect) } as CSSProperties}
        className="absolute top-1/2 aspect-(--ar) w-[min(92cqw,calc(86cqh*var(--ar)))] -translate-y-1/2 blur-[10px] max-[899px]:inset-s-1/2 max-[899px]:-translate-x-1/2 max-[899px]:rtl:translate-x-1/2 min-[900px]:inset-s-[62cqw] min-[900px]:top-[44cqh] min-[900px]:w-[min(50cqw,calc(62cqh*var(--ar)))] min-[900px]:-translate-x-1/2 min-[900px]:rtl:translate-x-1/2"
      >
        {cells}
      </svg>
    </div>
  );
}

export function FieldPoster({ panel, grid, reading }: { readonly panel: FieldPanelProps; readonly grid: FieldGrid; readonly reading: FieldReading }) {
  const t = useTranslations("judge.landing.field");
  const text = readoutText(reading);
  return (
    <>
      <FieldStage>
        <PosterMap grid={grid} hour={reading.hour} />
      </FieldStage>
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <FieldReadout
        reading={reading}
        live={false}
        announce={t("scrubber.valueText", { hour: text.hour, hottest: text.hottest, station: text.station })}
        proof={panel.proof}
        source={t(panel.highestOfSeason ? "sourcePeak" : "sourcePlain", { day: panel.dayLabel })}
      />
      <HourScrubber
        values={panel.omaa}
        ban={panel.ban}
        position={reading.hour}
        hour={reading.hour}
        dir={panel.dir}
        dayLabel={panel.dayLabel}
        valueText={t("scrubber.valueText", { hour: text.hour, hottest: text.hottest, station: text.station })}
        interactive={false}
        playing={false}
        calm={false}
      />
    </>
  );
}

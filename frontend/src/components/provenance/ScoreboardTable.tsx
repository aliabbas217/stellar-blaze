import { useTranslations } from "next-intl";
import { Proved } from "./Proved";
import type { Proof } from "./proof";

/*
 * The scoreboard table (Warnings and Plans). One shape for both: a policy or plan per row, one scored number per cell,
 * each with its interval and its proof chip. Rules the markup keeps:
 *   - a cell without a proof renders no number (`Proved` stands a missing-provenance note in its place);
 *   - a pending table (the scoring run has not written its file) shows "###" in every cell and no chip: the one banner
 *     explaining why belongs to the table's caller (one per table, never one per cell);
 *   - "ours" is distinguished by position (the caller puts it last), weight, an `aria-current` row and one accent rule,
 *     never by colour alone;
 *   - below 640 px every row stacks into a card: the heading of each column becomes the label before its value.
 */

export interface ScoreCell {
  /** The number, formatted for the reader. */
  readonly value: string;
  /** What the number counts, in words (the proof sheet prints it beside the number). Optional: the table's column heading says it. */
  readonly unit?: string;
  /** "95% interval 1.2 to 3.4" or similar, when the metric has one. */
  readonly interval?: string;
  /** What the number is, in words: names it for the proof chip and the missing-provenance note. */
  readonly what: string;
  readonly proof: Proof | null;
  /** The file has no denominator for this metric (the false-alarm share of a policy that never warns): shown as "not computed", never as 0. */
  readonly notComputed?: boolean;
}

export interface ScoreRow {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
  /** The Stellar Blaze row. */
  readonly ours: boolean;
  /** One per column, in the order of `columns`. */
  readonly cells: readonly ScoreCell[];
}

export interface ScoreboardTableProps {
  readonly caption: string;
  readonly columns: readonly { readonly key: string; readonly heading: string }[];
  readonly rows: readonly ScoreRow[];
  /** The scored file does not exist yet: every cell reads "###" and no proof is offered. */
  readonly pending?: boolean;
  /** The heading of the first column (the policy or plan name). */
  readonly rowHeading: string;
}

export function ScoreboardTable({ caption, columns, rows, pending = false, rowHeading }: ScoreboardTableProps) {
  const t = useTranslations("judge.scoreboard.table");
  return (
    <table data-scoreboard={pending ? "pending" : "scored"} className="w-full border-collapse text-start max-sm:block">
      <caption className="sr-only">{caption}</caption>
      <thead className="max-sm:sr-only">
        <tr className="border-b border-edge text-sm text-ink-3">
          <th scope="col" className="px-3 py-2 text-start font-medium">
            {rowHeading}
          </th>
          {columns.map((column) => (
            <th key={column.key} scope="col" className="px-3 py-2 text-end align-bottom font-medium">
              {column.heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-sm:block">
        {rows.map((row) => (
          <tr
            key={row.id}
            data-row={row.id}
            aria-current={row.ours ? "true" : undefined}
            className={`border-b border-hair max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-3 max-sm:py-4 ${
              row.ours ? "bg-panel font-medium max-sm:border-s-3 max-sm:border-s-signal max-sm:ps-3" : ""
            }`}
          >
            <th
              scope="row"
              className={`px-3 py-3 text-start align-top font-normal max-sm:col-span-2 max-sm:px-0 max-sm:py-0 ${
                row.ours ? "border-s-3 border-s-signal font-semibold max-sm:border-s-0" : "border-s-3 border-s-transparent max-sm:border-s-0"
              }`}
            >
              <span className="block text-base text-ink">{row.label}</span>
              <span className="block text-sm font-normal text-ink-3">{row.sublabel}</span>
              {row.ours ? <span className="sr-only">{t("ours")}</span> : null}
            </th>
            {columns.map((column, i) => {
              const cell = row.cells[i];
              return (
                <td
                  key={column.key}
                  data-label={column.heading}
                  className="px-3 py-3 text-end align-top tabular-nums max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:px-0 max-sm:py-0 max-sm:text-start max-sm:before:text-sm max-sm:before:font-normal max-sm:before:text-ink-3 max-sm:before:content-[attr(data-label)]"
                >
                  {pending || cell === undefined ? (
                    <span role="img" aria-label={t("notScored")} className="text-lg text-ink-3">
                      ###
                    </span>
                  ) : cell.notComputed === true ? (
                    <span data-not-computed="" className="text-base text-ink-3">
                      {t("notComputed")}
                    </span>
                  ) : (
                    <span className="flex flex-col items-end gap-1 max-sm:items-start">
                      <span className="flex items-center justify-end gap-2 max-sm:justify-start">
                        <Proved proof={cell.proof} what={cell.what}>
                          <span className="text-lg text-ink">{cell.value}</span>
                        </Proved>
                      </span>
                      {cell.interval !== undefined && cell.proof !== null ? (
                        <span className="text-sm font-normal whitespace-nowrap text-ink-3 max-sm:whitespace-normal">{cell.interval}</span>
                      ) : null}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

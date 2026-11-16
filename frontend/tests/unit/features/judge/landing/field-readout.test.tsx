import { screen } from "@testing-library/react";
import type { Proof } from "@/components/provenance/proof";
import type { FieldReading } from "@/features/judge/landing/field-data";
import { FieldReadout } from "@/features/judge/landing/FieldReadout";
import ar from "../../../../../messages/ar.json";
import en from "../../../../../messages/en.json";
import ur from "../../../../../messages/ur.json";
import { renderWithIntl } from "../../../../utils/intl";

/*
 * A value and its unit are one left-to-right run in every language. In Arabic and Urdu the readout's table cells showed "C° 30.7"
 * (the unit before the number): the cell had no isolation, so the bidi algorithm placed the neutral degree sign and the Latin letter
 * by the right-to-left paragraph. Task 22 review, found in the 1440 PNGs.
 */

const reading: FieldReading = { hour: 14, hottest: { value: 33.4, lat: 24.5, lon: 54.3 }, station: 30.7, cells: 374, cellsAbove: 374 };
const noProof = null as unknown as Proof;

function textNodes(root: Element): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) if ((n.textContent ?? "").trim() !== "") out.push((n.textContent ?? "").trim());
  return out;
}

describe("the readout's value and unit are an isolated left-to-right run", () => {
  for (const [locale, messages] of [["ur", ur], ["ar", ar], ["en", en]] as const) {
    it(`test_readout_unit_after_value_${locale}: the airport and limit cells read "30.7 °C" and "26.6 °C", each in its own dir=ltr isolate`, () => {
      const { container } = renderWithIntl(<FieldReadout reading={reading} source="source" proof={noProof} live announce="x" />, { locale, messages });
      const aside = container.querySelector("[data-field-readout]") as HTMLElement;
      const station = aside.querySelector("[data-readout-station]") as HTMLElement;
      const limit = station.nextElementSibling?.nextElementSibling as HTMLElement; // the cell after the limit's own label
      for (const [cell, value] of [[station, "30.7"], [limit, "26.6"]] as const) {
        const run = cell.querySelector("bdi[dir='ltr']");
        expect(run, `${locale}: the value and its unit are in a bdi dir=ltr`).not.toBeNull();
        expect(run?.textContent).toBe(`${value} °C`);
        expect(cell.textContent.startsWith(value)).toBe(true);
      }
      // no text node anywhere in the card starts with the unit before a number
      expect(textNodes(aside).filter((text) => /^C° ?\d/.test(text))).toEqual([]);
      expect(screen.queryByText(/^C° ?\d/)).toBeNull();
    });
  }
});

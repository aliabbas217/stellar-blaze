import { ProofChip } from "@/components/provenance/ProofChip";
import type { Proof } from "@/components/provenance/proof";
import { MissingProvenance } from "@/components/states/MissingProvenance";

/**
 * The other checks of a scoring run, each as a plain sentence composed from the structured fields of the export by a fixed template
 * (`verdict-plain.ts`), with the proof of the file behind it; the sentence the runner wrote sits unchanged in that proof's auditor layer.
 * A sentence whose file has no complete provenance is not shown: `MissingProvenance` stands in its place, the same as for a number.
 */
export interface VerdictItem {
  readonly id: string;
  readonly text: string;
  /** The file's own flag in plain words ("met" or "notMet"); null for a verdict with no template. */
  readonly result?: "met" | "notMet" | null;
}

export function VerdictList({ heading, items, proof, what }: { readonly heading: string; readonly items: readonly VerdictItem[]; readonly proof: Proof | null; readonly what: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-verdict-list="">
      <h3 className="text-base font-semibold text-ink">{heading}</h3>
      <ul className="grid gap-3">
        {items.map((item) => (
          <li key={item.id} data-verdict-id={item.id} {...(item.result == null ? {} : { "data-verdict-outcome": item.result })} className="max-w-(--measure) text-base text-ink">
            {proof === null ? (
              <MissingProvenance what={what} />
            ) : (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>{item.text}</span>
                <ProofChip proof={proof} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

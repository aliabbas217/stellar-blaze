import { ProofChip } from "@/components/provenance/ProofChip";
import type { Proof } from "@/components/provenance/proof";
import { MissingProvenance } from "@/components/states/MissingProvenance";

/**
 * The runner's other verdict sentences, each exactly as the scoring export wrote it (`HypothesisVerdict.text`, never
 * composed here), with the proof of the file behind them. A sentence whose file has no complete provenance is not shown:
 * `MissingProvenance` stands in its place, the same as for a number.
 */
export interface VerdictItem {
  readonly id: string;
  readonly text: string;
}

export function VerdictList({ heading, items, proof, what }: { readonly heading: string; readonly items: readonly VerdictItem[]; readonly proof: Proof | null; readonly what: string }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-verdict-list="">
      <h3 className="text-base font-semibold text-ink">{heading}</h3>
      <ul className="grid gap-3">
        {items.map((item) => (
          <li key={item.id} data-verdict-id={item.id} className="max-w-(--measure) text-base text-ink">
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

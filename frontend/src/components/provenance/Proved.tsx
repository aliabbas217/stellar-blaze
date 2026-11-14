import type { ReactNode } from "react";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { ProofChip } from "./ProofChip";
import type { Proof } from "./proof";

/**
 * The one way a scored number goes on a screen: `<Proved proof={...} what="...">{number}</Proved>`. With a proof it
 * renders the number and its chip; without one it renders `MissingProvenance` and never the number (every number has
 * provenance or is not shown).
 *
 * A server component on purpose: with no proof the children are never passed on to the client, so the value cannot reach
 * the browser through the serialized props of a client boundary. Compute the proof first and pass the number as the
 * child; do not interpolate it into `what`.
 */
export function Proved({
  proof,
  what,
  children,
}: {
  readonly proof: Proof | null;
  /** The number in words: names it in the chip and in the missing-provenance note. */
  readonly what: string;
  readonly children: ReactNode;
}) {
  if (proof === null) return <MissingProvenance what={what} />;
  return (
    <>
      {children}
      <ProofChip proof={proof} />
    </>
  );
}

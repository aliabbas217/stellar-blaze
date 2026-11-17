import { useTranslations } from "next-intl";
import { ProofChip } from "@/components/provenance/ProofChip";
import type { Proof } from "@/components/provenance/proof";

/*
 * The caption under the field: what the picture is (a forecast for one hot day across the UAE, an illustration and not the day that was
 * scored) and the "Where from" chip of the recorded forecast file behind it. It replaces the six-line readout of the old hero (redesign D7):
 * the field is the proof that heat is not uniform, not a table of readings. Presentational and hook-free apart from the message hook, so the
 * server states it in the first HTML and the island states it with the same code.
 */
export function FieldCaption({ proof }: { readonly proof: Proof }) {
  const t = useTranslations("judge.landing.field");
  return (
    <p data-field-caption="" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
      <span data-contrast="body" data-contrast-name="field-caption" className="min-w-0 flex-1 basis-56">
        {t("caption")}
      </span>
      <ProofChip proof={proof} />
    </p>
  );
}

import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { ProofChip } from "./ProofChip";
import type { Proof } from "./proof";

export interface VerdictProps {
  /**
   * The outcome sentence, exactly as the scoring export wrote it (`HypothesisVerdict.text`); never composed here. Null
   * until the single scoring run has written its file: the pending text stands in.
   */
  readonly sentence: string | null;
  /** Null with a sentence present: the sentence has no provenance and is not shown. */
  readonly proof: Proof | null;
  /** The data-tier stamp (`DEV 2025`) when the sentence does not come from the held-out run; shown under the heading. */
  readonly stamp?: ReactNode;
}

/**
 * "What the season showed": the one sentence the pre-registered outcome table picks, written the same way whether the
 * product won or lost. A sentence without provenance is as unshowable as a number without it.
 */
export function Verdict({ sentence, proof, stamp }: VerdictProps) {
  const t = useTranslations("judge.scoreboard.verdict");
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-verdict={sentence === null ? "pending" : "written"}
      className="grid gap-2 rounded-sign border border-hair border-s-3 border-s-ink-2 bg-panel p-4 sm:p-6"
    >
      <h2 id={headingId} className="text-sm font-medium text-ink-3">
        {t("heading")}
      </h2>
      {stamp}
      {sentence === null ? (
        <p className="max-w-(--measure) text-lg text-ink-2 sm:text-xl">{t("pending")}</p>
      ) : proof === null ? (
        <MissingProvenance what={t("heading")} />
      ) : (
        <p className="flex max-w-(--measure) flex-wrap items-center gap-x-3 gap-y-2 text-lg text-ink sm:text-xl">
          <span>{sentence}</span>
          <ProofChip proof={proof} />
        </p>
      )}
      <p className="max-w-(--measure) text-sm text-ink-3">{t("note")}</p>
    </section>
  );
}

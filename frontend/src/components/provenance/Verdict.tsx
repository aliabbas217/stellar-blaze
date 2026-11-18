import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { ProofChip } from "./ProofChip";
import type { Proof } from "./proof";

export interface VerdictProps {
  /**
   * The outcome sentence in plain words, composed from the structured fields of the scoring export by a fixed template
   * (`features/judge/verdict-plain.ts`); the sentence the runner wrote is in the proof's auditor layer. Null until the single
   * scoring run has written its file: the pending text stands in.
   */
  readonly sentence: string | null;
  /** The file's own flag for this verdict in plain words, for a test and a screen reader's data attribute; never read from the sentence. */
  readonly outcome?: "met" | "notMet" | null;
  /** Null with a sentence present: the sentence has no provenance and is not shown. */
  readonly proof: Proof | null;
  /** The data-tier stamp (`DEV 2025`) when the sentence does not come from the held-out run; shown under the heading. */
  readonly stamp?: ReactNode;
  /** One line under the sentence (for example what the prior run found), in the caller's words: never part of the sentence. */
  readonly caption?: string | null;
}

/**
 * "What the season showed": the one sentence for the main check, written the same way whether the product did well or badly.
 * A sentence without provenance is as unshowable as a number without it.
 */
export function Verdict({ sentence, outcome = null, proof, stamp, caption = null }: VerdictProps) {
  const t = useTranslations("judge.scoreboard.verdict");
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-verdict={sentence === null ? "pending" : "written"}
      {...(outcome === null ? {} : { "data-verdict-outcome": outcome })}
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
      {caption === null ? null : (
        <p className="max-w-(--measure) text-sm text-ink-2" data-verdict-caption="">
          {caption}
        </p>
      )}
      <p className="max-w-(--measure) text-sm text-ink-3">{t("note")}</p>
    </section>
  );
}

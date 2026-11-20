import { useLocale, useTranslations } from "next-intl";
import { AuditDetails, AuditRows, RecountButton, StoryRows } from "@/components/provenance/ProofRows";
import { EmptyState } from "@/components/states/EmptyState";
import { FieldLink } from "@/components/shell/FieldLink";
import { EvalSourceStamp } from "./EvalSourceStamp";
import { FORECAST_CLAIMS, type Claim } from "./claims";
import type { EvalSource } from "./data";
import { claimsLocale } from "@/i18n/claims-english";

/**
 * The proof sheet (`/replay/proof/<claim>`): one number as large as it gets (it is not a step of the story: it is reached from a number's "Where from" chip) and "Where this number comes from" in plain words
 * (the same story as the drawer). The technical record, the number's three-step timeline (scored numbers only) and the button
 * that recounts the file in this browser are under "For auditors", a closed `<details>` (`#audit`). The sheet exists for a number that has a complete record and
 * for nothing else: an unknown id and a number without a record both get the empty state ("not shown as a result") with a link to a number that does have one.
 */

export interface ProofSheetProps {
  /** The claim, or null for an id that is not one (or has no provenance). */
  readonly claim: Claim | null;
  readonly source: EvalSource;
  /** The number is a scored one and its file exists but could not be read: a read failure, never "no provenance". */
  readonly unreadable?: boolean;
}

const SHEET = "mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8";

export function ProofSheet({ claim, source, unreadable = false }: ProofSheetProps) {
  const t = useTranslations("judge.proof");

  if (claim === null && unreadable) {
    return (
      <main id="main-content" className={SHEET} data-sheet-state="unreadable">
        <h1 className="font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{t("title")}</h1>
        <EmptyState
          title={t("unreadableTitle")}
          reason={t("unreadableReason")}
          primary={{ label: t("back"), href: "/replay" }}
          secondary={{ label: t("emptyAction"), href: `/replay/proof/${FORECAST_CLAIMS.hours}` }}
        />
      </main>
    );
  }

  if (claim === null) {
    return (
      <main id="main-content" className={SHEET} data-sheet-state="empty">
        <h1 className="font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{t("title")}</h1>
        <EmptyState
          title={t("emptyTitle")}
          reason={t("emptyReason")}
          primary={{ label: t("emptyAction"), href: `/replay/proof/${FORECAST_CLAIMS.hours}` }}
          secondary={{ label: t("back"), href: "/replay" }}
        />
      </main>
    );
  }

  return (
    <main id="main-content" className={SHEET} data-claim={claim.id}>
      <header className="flex flex-col gap-3">
        <p className="text-sm text-ink-3">{t("title")}</p>
        <h1 className="max-w-(--measure) text-xl font-medium text-ink sm:text-2xl">{claim.what}</h1>
        <EvalSourceStamp source={claim.kind === "scored" ? source : "none"} />
      </header>

      <div className="flex w-full max-w-3xl flex-col gap-8">
        <section aria-label={claim.what} className="flex flex-col gap-2" data-sheet-number="">
          <strong className="font-display text-5xl leading-solid font-normal tracking-display tabular-nums text-ink sm:text-6xl">
            {claim.value}
          </strong>
          {claim.unit === undefined || claim.unit === "" ? null : (
            <p className="max-w-(--measure) text-lg text-ink-2 sm:text-xl" data-sheet-unit="">
              {claim.unit}
            </p>
          )}
          {claim.interval === undefined ? null : <p className="text-base whitespace-nowrap text-ink-2 tabular-nums">{claim.interval}</p>}
        </section>

        <section aria-label={t("title")} data-sheet-story="">
          <StoryRows proof={claim.proof} flush />
          {claim.kind === "scored" && source === "synthetic-shape" ? (
            <p className="max-w-(--measure) text-sm text-ink-2" data-sheet-note="">
              {t("notes.synthetic")}
            </p>
          ) : null}
        </section>

        <AuditDetails>
          <AuditRows proof={claim.proof} />
          <Timeline claim={claim} />
          <RecountButton proof={claim.proof} />
        </AuditDetails>

        <p>
          <FieldLink href="/replay" className="inline-flex min-h-(--target) items-center text-base text-ink underline underline-offset-4">
            {t("back")}
          </FieldLink>
        </p>
      </div>
    </main>
  );
}

/**
 * The number's timeline, for a SCORED claim only (one with the held-out run's record): three steps that cannot contradict each
 * other. A recorded count or an analysis has no scoring run, so it has no timeline (its story says what it is, in one line).
 */
function Timeline({ claim }: { readonly claim: Claim }) {
  const t = useTranslations("judge.proof");
  const locale = claimsLocale(useLocale());
  const evaluation = claim.proof.evaluation;
  if (claim.kind !== "scored" || evaluation === undefined) return null;
  const generated = claim.proof.generatedAt;
  const at =
    generated === null
      ? null
      : new Intl.DateTimeFormat(`${locale === "en" ? "en-GB" : locale}-u-nu-latn`, { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Dubai" }).format(new Date(generated));
  const steps = [
    { id: "plan", note: t("notes.planLocked", { commit: evaluation.protocolCommit.slice(0, 7) }) },
    { id: "run", note: t("notes.runScored") },
    { id: "shown", note: t("notes.shown") },
  ] as const;

  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-3 px-4 pb-4" data-timeline-section="">
      <h2 id="timeline-heading" className="font-display text-lg font-medium">
        {t("timelineHeading")}
      </h2>
      <ol className="grid gap-x-8 gap-y-5 sm:grid-cols-3" data-timeline="">
        {steps.map((step, index) => (
          <li key={step.id} data-step={step.id} className="flex flex-col gap-1 border-t border-edge pt-3">
            <span className="text-sm text-ink-3 tabular-nums">{index + 1}</span>
            <span className="text-base font-medium text-ink">{t(`timeline.${step.id}`)}</span>
            <span className="max-w-(--measure) text-sm text-ink-2">{step.note}</span>
            {step.id === "run" && at !== null ? (
              <time dateTime={generated ?? undefined} className="text-sm text-ink tabular-nums">
                {at}
              </time>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

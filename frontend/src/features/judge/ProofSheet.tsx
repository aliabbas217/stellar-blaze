import { useLocale, useTranslations } from "next-intl";
import { ProofRows, RecountButton } from "@/components/provenance/ProofRows";
import { StoryNav } from "@/components/shell/StoryNav";
import { EmptyState } from "@/components/states/EmptyState";
import { Link } from "@/i18n/navigation";
import { EvalSourceStamp } from "./EvalSourceStamp";
import { FORECAST_CLAIMS, type Claim } from "./claims";
import type { EvalSource } from "./data";

/**
 * The proof sheet (`/replay/proof/<claim>`): one number as large as it gets, where it comes from (the same rows as the
 * drawer), the number's timeline (forecast made, protocol committed, scoring run, shown) and a button that recounts the file
 * in this browser. The sheet exists for a number that has provenance and for nothing else: an unknown id and a number
 * without a proof both get the empty state ("not shown as a result") with a link to a number that does have one.
 */

export interface ProofSheetProps {
  /** The claim, or null for an id that is not one (or has no provenance). */
  readonly claim: Claim | null;
  readonly source: EvalSource;
}

const SHEET = "mx-auto flex w-full max-w-(--content-max) flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8";

export function ProofSheet({ claim, source }: ProofSheetProps) {
  const t = useTranslations("judge.proof");

  if (claim === null) {
    return (
      <main id="main-content" className={SHEET}>
        <h1 className="font-display text-3xl leading-solid font-normal tracking-display sm:text-4xl">{t("title")}</h1>
        <EmptyState
          title={t("emptyTitle")}
          reason={t("emptyReason")}
          primary={{ label: t("emptyAction"), href: `/replay/proof/${FORECAST_CLAIMS.hours}` }}
          secondary={{ label: t("back"), href: "/replay" }}
        />
        <StoryNav current="proof" />
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

      <section aria-label={claim.what} className="flex flex-col gap-2" data-sheet-number="">
        <strong className="font-display text-5xl leading-solid font-normal tracking-display tabular-nums text-ink sm:text-6xl">
          {claim.value}
        </strong>
        {claim.interval === undefined ? null : <p className="text-base text-ink-2 tabular-nums">{claim.interval}</p>}
      </section>

      <Timeline claim={claim} source={source} />

      <section aria-labelledby="proof-rows-heading" className="flex max-w-xl flex-col rounded-sign border border-hair bg-panel">
        <h2 id="proof-rows-heading" className="border-b border-hair px-4 py-3 font-display text-lg font-medium">
          {t("rowsHeading")}
        </h2>
        <ProofRows proof={claim.proof} />
        <RecountButton proof={claim.proof} />
      </section>

      <p>
        <Link href="/replay" className="inline-flex min-h-(--target) items-center text-base text-ink underline underline-offset-4">
          {t("back")}
        </Link>
      </p>
      <StoryNav current="proof" />
    </main>
  );
}

function Timeline({ claim, source }: { readonly claim: Claim; readonly source: EvalSource }) {
  const t = useTranslations("judge.proof");
  const locale = useLocale();
  const kind = claim.kind;
  const generated = claim.proof.generatedAt;
  const at =
    generated === null
      ? null
      : new Intl.DateTimeFormat(`${locale === "en" ? "en-GB" : locale}-u-nu-latn`, { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Dubai" }).format(new Date(generated));

  const steps = [
    { id: "forecast", note: kind === "analysis" ? t("notes.notAForecast") : t("notes.forecastAhead") },
    {
      id: "protocol",
      note: kind === "scored" ? t("notes.protocolCommitted") : kind === "forecast" ? t("notes.noProtocolForecast") : t("notes.noProtocolAnalysis"),
    },
    {
      id: "run",
      note: kind !== "scored" ? t("notes.runNotScoring") : source === "2026" ? t("notes.runScored") : t("notes.runDev"),
    },
    { id: "shown", note: t("notes.shown") },
  ] as const;

  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
      <h2 id="timeline-heading" className="font-display text-lg font-medium">
        {t("timelineHeading")}
      </h2>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-timeline="">
        {steps.map((step, index) => (
          <li key={step.id} data-step={step.id} className="flex flex-col gap-1 border-t border-edge pt-3">
            <span className="text-sm text-ink-3 tabular-nums">{index + 1}</span>
            <span className="text-base font-medium text-ink">{t(`timeline.${step.id}`)}</span>
            <span className="max-w-(--measure) text-sm text-ink-2">{step.note}</span>
            {step.id === "run" && kind === "scored" && at !== null ? (
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

import { useTranslations } from "next-intl";
import { LevelMark } from "@/components/level/LevelSign";
import { Pictogram } from "@/components/level/Pictogram";
import { ProofChip } from "@/components/provenance/ProofChip";
import { FieldLink } from "@/components/shell/FieldLink";
import { ACTION_PRIMARY, ACTION_SECONDARY, ACTION_STOP } from "@/components/states/actions";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { policyClaim } from "@/features/judge/adapters";
import { CLAIMS_ENGLISH } from "@/i18n/claims-english";
import type { Evidence } from "./evidence";

/*
 * The chapters of the landing story after the hero (redesign S2): a morning on site, tonight's plan, the boundary, last summer replayed, and what
 * this does not show yet. Their copy is Tier 2 (`judge.landing.story.*`, English by design, decision D2): each chapter is a `lang="en" dir="ltr"`
 * block, like the scoreboard it leads to, so a reader in Arabic or Urdu sees the page chrome, the hero and the role door in their language and the
 * argument in English, with its numbers and the sentence that says what they are. Server components with no script.
 *
 * The pictures of the crew screen and of the refusal are static demo pictures (`aria-hidden`, `inert`, labelled as made up); the numbers are
 * not: the four bars and their sentences come from `evidence.ts`, which reads the scored file. The three "Where from" chips of the page are the
 * field's caption, the bars and the two checks; nothing here prints a count that is not behind one of them.
 */

const CHAPTER = "grid scroll-mt-4 gap-6 min-[900px]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] min-[900px]:gap-12";
const HEADING = "font-display text-3xl leading-(--sign-leading-display) font-normal tracking-display";
const EYEBROW = "text-sm font-semibold tracking-wide text-ink-3 uppercase";
const TAG = "rounded-ctl px-1.5 py-0.5 text-xs font-semibold tracking-wide text-ink-2 uppercase inset-ring-[1.5px] inset-ring-edge";

export function Chapters({ evidence }: { readonly evidence: Evidence | null }) {
  return (
    <div {...CLAIMS_ENGLISH} data-claims-english="" data-landing-chapters="" className="flex flex-col gap-24">
      <Morning />
      <Plan />
      <Boundary />
      <EvidenceChapter evidence={evidence} />
      <Limits />
    </div>
  );
}

function Morning() {
  const t = useTranslations("judge.landing.story.morning");
  return (
    <section id="morning" aria-labelledby="morning-title" className={CHAPTER}>
      <div className="grid content-start gap-4">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 id="morning-title" className={HEADING}>
          {t("heading")}
        </h2>
      </div>
      <div className="grid max-w-[52ch] content-start gap-4 text-lg text-ink-2">
        <p>{t("body1")}</p>
        <p>{t("body2")}</p>
        <FieldLink href="/worker" className={`${ACTION_SECONDARY} justify-self-start`}>
          {t("link")}
        </FieldLink>
      </div>
    </section>
  );
}

const PLAN_CREWS = ["crewA", "crewC", "crewD"] as const;

function Plan() {
  const t = useTranslations("judge.landing.story.plan");
  return (
    <section id="plan" aria-labelledby="plan-title" className={CHAPTER}>
      <div className="grid content-start gap-4">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 id="plan-title" className={HEADING}>
          {t("heading")}
        </h2>
        <p className="max-w-[46ch] text-lg text-ink-2">{t("body")}</p>
        <FieldLink href="/supervisor" className={`${ACTION_SECONDARY} justify-self-start`}>
          {t("link")}
        </FieldLink>
      </div>
      <figure className="grid min-w-0 gap-3">
        {/* A picture of the crews screen, not the screen: nothing in it can be pressed. The crews and the times are made up, and it says so. */}
        <div aria-hidden="true" inert data-plan-picture="" className="grid gap-4 rounded-card bg-panel p-4 min-[640px]:p-5">
          <ul className="grid">
            {PLAN_CREWS.map((crew) => (
              <li key={crew} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-hair py-4 first:pt-0 last:border-b-0 min-[640px]:grid-cols-[10rem_minmax(0,1fr)_auto]">
                <span className="grid">
                  <span className="text-base font-semibold text-ink">{t(`${crew}.name`)}</span>
                  <span className="text-sm text-ink-3">{t(`${crew}.task`)}</span>
                </span>
                <span className="col-span-2 flex items-center gap-2 text-lg font-semibold text-ink min-[640px]:order-none min-[640px]:col-span-1">
                  <LevelMark level="orange" />
                  {t("level")}
                </span>
                <span className="row-start-1 col-start-2 justify-self-end min-[640px]:row-start-auto min-[640px]:col-start-auto">
                  <span className={TAG}>{t("unsigned")}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className={ACTION_STOP}>
            <Pictogram name="cross" className="size-5" />
            <span>{t("stop")}</span>
          </div>
        </div>
        <figcaption className="flex items-center gap-2 text-sm text-ink-3">
          <span className={TAG}>{t("tag")}</span>
          <span>{t("demo")}</span>
        </figcaption>
      </figure>
    </section>
  );
}

function Boundary() {
  const t = useTranslations("judge.landing.story.boundary");
  return (
    <section id="boundary" aria-labelledby="boundary-title" className={CHAPTER}>
      <div className="grid content-start gap-4">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 id="boundary-title" className={HEADING}>
          {t("heading")}
        </h2>
        <p className="max-w-[46ch] text-lg text-ink-2">{t("body")}</p>
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <div className="grid gap-3" data-boundary-exchange="">
          <p className="rounded-card bg-panel px-4 py-3 text-base text-ink">
            <b className="font-semibold">{t("request")}</b> {t("requestDetail")}
          </p>
          <p className="rounded-card bg-panel px-4 py-3 text-base text-ink">
            <b className="font-semibold">{t("refused")}</b> {t("refusedDetail")}
          </p>
        </div>
        <FieldLink href="/replay/governance" className={`${ACTION_SECONDARY} justify-self-start`}>
          {t("link")}
        </FieldLink>
      </div>
    </section>
  );
}

function EvidenceChapter({ evidence }: { readonly evidence: Evidence | null }) {
  const t = useTranslations("judge.landing.story.evidence");
  return (
    <section id="evidence" aria-labelledby="evidence-title" className={CHAPTER}>
      <div className="grid content-start gap-4">
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <h2 id="evidence-title" className={HEADING}>
          {t("heading")}
        </h2>
        <p className="max-w-[46ch] text-lg text-ink-2">{t("body")}</p>
      </div>
      <div className="grid min-w-0 content-start gap-6">
        {evidence?.barsProof == null ? (
          <MissingProvenance what={t("unavailable")} />
        ) : (
          <>
            <p className="text-sm text-ink-2">{t("caption")}</p>
            <ul className="grid gap-5" data-evidence-bars="">
              {evidence.bars.map((bar) => (
                <li key={bar.id} data-policy={bar.id} data-ours={bar.ours ? "" : undefined} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 min-[640px]:grid-cols-[11rem_minmax(0,1fr)_4.5rem]">
                  <span className={`col-span-2 text-base text-ink min-[640px]:col-span-1 ${bar.ours ? "font-semibold" : ""}`}>{bar.label}</span>
                  <span aria-hidden="true" className="h-4 min-w-0 overflow-hidden rounded-sign bg-panel">
                    <span className={`block h-full rounded-sign ${bar.ours ? "bg-signal" : "bg-ink-3"}`} style={{ width: `${String(Math.max(bar.share * 100, bar.missedValue > 0 ? 1 : 0))}%` }} />
                  </span>
                  <span data-bar-missed="" className="text-end text-xl font-semibold text-ink tabular-nums">{bar.missed}</span>
                  <span data-bar-false-alarms="" className="col-span-2 text-sm text-ink-3 tabular-nums min-[640px]:col-start-2 min-[640px]:col-span-2">
                    {t("falseAlarms", { n: bar.falseAlarms })}
                  </span>
                </li>
              ))}
            </ul>
            {evidence.tradeoff === null ? null : (
              <p className="max-w-(--measure) text-base text-ink" data-warnings-tradeoff="">
                {evidence.tradeoff}
              </p>
            )}
            <p>
              <ProofChip proof={evidence.barsProof} />
            </p>
            {evidence.verdicts.length === 0 || evidence.verdictProof === null ? null : (
              <div className="grid gap-2" data-verdict-list="">
                <h3 className="text-base font-semibold text-ink">{t("verdicts")}</h3>
                <ul className="grid gap-3">
                  {evidence.verdicts.map((verdict) => (
                    <li key={verdict.id} data-verdict-id={verdict.id} {...(verdict.result === null ? {} : { "data-verdict-outcome": verdict.result })} className="max-w-(--measure) text-base text-ink">
                      {verdict.text}
                    </li>
                  ))}
                </ul>
                <p>
                  <ProofChip proof={evidence.verdictProof} />
                </p>
              </div>
            )}
          </>
        )}
        <FieldLink href="/replay" className={`${ACTION_SECONDARY} justify-self-start`}>
          {t("scoreboard")}
        </FieldLink>
      </div>
    </section>
  );
}

const LIMITS = ["one", "two", "three", "four"] as const;

/** The auditors' door: the proof sheet of the headline number, opened at its "For auditors" record (the sheet's `#audit`). */
export const AUDITORS_HREF = `/replay/proof/${policyClaim("P3_protect", "missed_danger_hours")}#audit`;

function Limits() {
  const t = useTranslations("judge.landing.story.limits");
  return (
    <section id="limits" aria-labelledby="limits-title" className="grid gap-6">
      <h2 id="limits-title" className={EYEBROW}>
        {t("eyebrow")}
      </h2>
      <ul className="grid max-w-5xl gap-x-12 gap-y-0 min-[900px]:grid-cols-2">
        {LIMITS.map((item) => (
          <li key={item} className="border-t border-edge py-4 text-lg text-ink-2">
            {t(item)}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <FieldLink href="/replay" className={ACTION_PRIMARY}>
          {t("tested")}
        </FieldLink>
        <FieldLink href={AUDITORS_HREF} className={ACTION_SECONDARY}>
          {t("auditors")}
        </FieldLink>
      </div>
    </section>
  );
}

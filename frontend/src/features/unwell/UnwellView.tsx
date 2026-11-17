import { useTranslations } from "next-intl";
import { Pictogram } from "@/components/level/Pictogram";
import { Stamp } from "@/components/provenance/Stamp";
import { CallActions, OfflineNotice } from "@/features/unwell/CallActions";
import { CLINICAL_REVIEW, reviewLabel } from "@/features/unwell/clinical-review";
import { ElapsedTimer } from "@/features/unwell/ElapsedTimer";

/*
 * The "I feel unwell" call sheet (F2 Task 18, ADR 0045 and 0065). A server component: everything except the timer and the
 * calls (the two client parts, which read the clock and the phone's own storage) is rendered at build, so the page is static,
 * precached for every locale (features/pwa/fallback.ts) and opens offline.
 *
 * Three calls, 998 first. The steps are the ADOSH-SF Technical Guideline's own words, section 4.5(c), unedited and with no
 * other clinical wording (no "sip water": it is not in that clause). The sheet says it has not been clinically reviewed until
 * `CLINICAL_REVIEW` holds a review date. Nothing on it is logged or sent, and it says so.
 *
 * `clinicalReview` is a prop only so a test or a dev story can render the reviewed label; the page never passes it, so the
 * constant is the one source in production.
 */

const STEP_KEYS = ["one", "two", "three"] as const;

export function UnwellView({ clinicalReview = CLINICAL_REVIEW }: { readonly clinicalReview?: string | null }) {
  const t = useTranslations("worker.unwell");
  const review = reviewLabel(clinicalReview);

  return (
    <div className="flex flex-col gap-6 pb-6">
      <OfflineNotice />

      {/* The hero: the timer and the calls. It carries data-hero (the gate's hero share) and the 998 call inside it is the emergency action. */}
      <section aria-label={t("calls.label")} data-hero="" className="flex flex-col gap-4 px-4 pt-3">
        <ElapsedTimer />
        <CallActions heroIcon={<Pictogram name="handset" className="size-11" />} rowIcon={<Pictogram name="handset" className="size-8" />} />
        <p className="text-lg leading-(--sign-leading-text) font-medium text-ink">{t("privacy")}</p>
      </section>

      <section aria-labelledby="unwell-steps" className="flex flex-col px-4">
        <h2 id="unwell-steps" className="border-b border-hair pb-2 text-base font-medium text-ink-3">
          {t("steps.heading")}
        </h2>
        <ol className="m-0 flex list-none flex-col p-0">
          {STEP_KEYS.map((key, index) => (
            <li
              key={key}
              className="grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 border-b border-hair py-3 text-xl leading-(--sign-leading-text) font-medium text-ink"
            >
              {/* fixed-height-ok: a step-number circle holding one Western digit (aria-hidden; the step's sentence beside it is the text and sits in the free row) */}
              <span
                aria-hidden="true"
                className="grid size-9 place-items-center rounded-sign border-2 border-ink text-lg leading-none font-semibold tabular-nums"
              >
                {index + 1}
              </span>
              <span>{t(`steps.${key}`)}</span>
              {key === "two" ? <Pictogram name="shade" className="size-10" /> : null}
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-2 pt-3 text-sm text-ink-3">
          <p>{t("steps.source")}</p>
          <p className="flex flex-wrap items-center gap-2">
            {review.kind === "reviewed" ? (
              <span className="inline-block rounded-sign border border-edge px-2 py-0.5 text-sm leading-(--sign-leading-text) font-medium text-ink-2">
                {t.rich("steps.reviewed", { date: review.date, bdi: (chunks) => <bdi>{chunks}</bdi> })}
              </span>
            ) : (
              <Stamp kind="NOT_CLINICALLY_REVIEWED" />
            )}
          </p>
        </div>
      </section>
    </div>
  );
}

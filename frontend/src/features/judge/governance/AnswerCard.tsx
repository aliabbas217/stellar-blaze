import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/states/Skeletons";
import { WakingLine } from "@/components/states/WakingLine";
import { REFUSED_TYPE } from "./answer";
import type { RefusalAnswer } from "./recorded-view";

export interface AnswerCardProps {
  /** The answer to show: the live one, or the recorded one before any call. Null when there is none. */
  readonly answer: RefusalAnswer | null;
  readonly pending: boolean;
  /** The answer is a recorded example (not a live call): its request id is a placeholder of the recording and is not printed as an id. */
  readonly example?: boolean;
}

/** The skeleton's height: the answer card's content (status line, content type, four fields). */
export const ANSWER_SKELETON_HEIGHT = "13rem";

/**
 * Step 2: the service's answer, 403 and the problem fields. Only the members the page knows are printed: `type` and
 * `request_id` as identifiers in mono, `title` as the API wrote it, and the explanation in the page's own words (the API's
 * `detail` carries a design-record reference that does not belong in product copy). An unknown problem type gets its title
 * and request id and no explanation, so nothing the page cannot vouch for is worded as a refusal.
 */
export function AnswerCard(props: AnswerCardProps) {
  return (
    <>
      <AnswerBody {...props} />
      {/* The request is a live call and can be waiting for a scaled-to-zero API. Beside the card, not in it: the card is aria-busy
          while pending, and a change inside a busy region is not announced. */}
      {props.pending ? <WakingLine /> : null}
    </>
  );
}

function AnswerBody({ answer, pending, example = false }: AnswerCardProps) {
  const t = useTranslations("judge.governance.answer");
  return (
    <div className="grid content-start gap-3" aria-busy={pending}>
      <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
      {pending ? (
        <>
          <Skeleton height={ANSWER_SKELETON_HEIGHT} />
          <p role="status" className="sr-only">
            {t("waiting")}
          </p>
        </>
      ) : answer === null ? (
        <p className="text-base text-ink-3" data-answer="none">
          {t("none")}
        </p>
      ) : (
        <div className="grid gap-3" data-answer="shown">
          <p className="flex items-baseline gap-3">
            <strong className="font-display text-4xl leading-solid font-medium tabular-nums text-ink" data-status="">
              {answer.status}
            </strong>
            <span className="text-lg text-ink">{t("refused")}</span>
          </p>
          <p className="font-mono text-xs text-ink-3" dir="ltr" translate="no">
            content-type: {answer.contentType}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-3">{t("type")}</dt>
            <dd className="font-mono text-xs break-all text-ink" dir="ltr" translate="no">
              {answer.type}
            </dd>
            <dt className="text-ink-3">{t("problemTitle")}</dt>
            <dd className="text-ink">{answer.title}</dd>
            {answer.type === REFUSED_TYPE ? (
              <>
                <dt className="text-ink-3">{t("detail")}</dt>
                <dd className="text-ink">{t("detailRefused")}</dd>
              </>
            ) : null}
            {answer.requestId === null ? null : (
              <>
                <dt className="text-ink-3">{t("requestId")}</dt>
                <dd className="font-mono text-xs break-all text-ink" dir="ltr" translate="no">
                  {example ? t("exampleValue") : answer.requestId}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

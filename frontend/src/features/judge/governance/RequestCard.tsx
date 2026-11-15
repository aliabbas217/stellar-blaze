import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ACTION_PRIMARY } from "@/components/states/actions";

/** Every visible label comes from messages: the contract's class names are data keys, never copy. */
const DATA_CLASS_KEY = { health: "dataClassHealth", personal: "dataClassPersonal", exposure: "dataClassExposure" } as const;

export interface RequestCardProps {
  /** The path the request goes to, with the site id filled in. */
  readonly path: string;
  /** The made-up worker reference the request carries (the API discards it). */
  readonly workerRef: string;
  readonly dataClass: "health" | "personal" | "exposure";
  /** A call reached the service from this page: the button then reads "Send again". */
  readonly sentBefore: boolean;
  readonly pending: boolean;
  readonly onSend: () => void;
  /** What went wrong with the call just made: shown under the button, where the person who pressed it is looking. */
  readonly notice?: ReactNode;
}

/**
 * Step 1: the employer's request. There is no purpose to pick: the answer does not depend on one (ADR 0054), so a control
 * for it would suggest it does. The button never fires by itself, keeps its label while the call runs, and is never
 * disabled before it is pressed.
 */
export function RequestCard({ path, workerRef, dataClass, sentBefore, pending, onSend, notice }: RequestCardProps) {
  const t = useTranslations("judge.governance.request");
  return (
    <div className="grid content-start gap-3">
      <h3 className="text-base font-semibold text-ink">{t("title")}</h3>
      <p className="font-mono text-sm break-words text-ink" dir="ltr" translate="no">
        <span className="me-2 font-semibold">POST</span>
        {path}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-3">{t("subject")}</dt>
        <dd className="text-ink">{t("subjectValue")}</dd>
        <dt className="text-ink-3">{t("dataClass")}</dt>
        <dd className="text-ink">{t(DATA_CLASS_KEY[dataClass])}</dd>
        <dt className="text-ink-3">{t("workerRef")}</dt>
        <dd className="font-mono break-words text-ink" dir="ltr" translate="no">
          {workerRef}
        </dd>
      </dl>
      <p className="text-sm text-ink-3">{t("refNote")}</p>
      <button type="button" data-primary="" aria-busy={pending} onClick={onSend} className={`${ACTION_PRIMARY} w-full gap-2`}>
        {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
        {sentBefore ? t("sendAgain") : t("send")}
      </button>
      {notice}
      <p className="text-sm text-ink-3">{t("caption")}</p>
    </div>
  );
}

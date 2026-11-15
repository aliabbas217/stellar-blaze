"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PROOF_LABELS, recountSha256, recountUrl, type Proof } from "./proof";

/*
 * The rows of a proof (protocol, script, file, fingerprints, label, model, time) and the recount button. Shared by the
 * drawer (beside a number) and the proof sheet (a page of its own): one place decides what a proof shows.
 */

export function ProofRows({ proof }: { readonly proof: Proof }) {
  const t = useTranslations("states.proof");
  const none = t("notRecorded");
  return (
    <dl className="grid gap-4 p-4">
      <Row name={t("rows.number")}>{proof.what}</Row>
      <Row name={t("rows.protocol")} code>
        {proof.protocolHref === null ? (
          proof.protocol
        ) : (
          <a href={proof.protocolHref} className="underline" rel="noreferrer">
            {proof.protocol}
          </a>
        )}
      </Row>
      <Row name={t("rows.script")} code>
        {proof.script}
      </Row>
      <Row name={t("rows.file")} code>
        {proof.file}
      </Row>
      <Row name={t("rows.sha")}>
        <span className="flex flex-col gap-3">
          <Hash caption={t("sha.file")} value={proof.fileSha256 ?? none} />
          <Hash caption={t("sha.source")} value={proof.sourceSha256 ?? none} />
        </span>
      </Row>
      <Row name={t("rows.label")}>{t(`labels.${PROOF_LABELS[proof.label]}`)}</Row>
      {proof.evaluation === undefined ? null : (
        <Row name={t("rows.lock")}>
          <span className="flex flex-col gap-3">
            <span className="text-base text-ink">{t("lock.note")}</span>
            <Hash caption={t("lock.hash")} value={proof.evaluation.lockSha256} />
            <Hash caption={t("lock.protocolCommit")} value={proof.evaluation.protocolCommit} />
          </span>
        </Row>
      )}
      <Row name={t("rows.model")} code>
        {proof.modelId ?? none}
      </Row>
      <Row name={t("rows.generated")} code>
        {proof.generatedAt ?? none}
      </Row>
    </dl>
  );
}

function Row({ name, children, code = false }: { readonly name: string; readonly children: ReactNode; readonly code?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-ink-3">{name}</dt>
      <dd className={code ? "font-mono text-sm break-all text-ink" : "text-base break-words text-ink"}>{children}</dd>
    </div>
  );
}

function Hash({ caption, value }: { readonly caption: string; readonly value: string }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="text-sm text-ink-3">{caption}</span>
      <code className="font-mono text-sm break-all text-ink">{value}</code>
    </span>
  );
}

type RecountState = "idle" | "busy" | "match" | "mismatch" | "failed";

/**
 * "Recount in this browser": fetches the published file, hashes it with `crypto.subtle` and compares with the
 * fingerprint this page was built with. Only files under /data are recountable (proof.ts, `recountUrl`); for any other
 * the drawer says so and offers nothing, because a button that could never succeed is a promise.
 */
export function RecountButton({ proof }: { readonly proof: Proof }) {
  const t = useTranslations("states.proof");
  const [state, setState] = useState<RecountState>("idle");
  const running = useRef(false);

  if (recountUrl(proof) === null) {
    return <p className="px-4 pb-4 text-sm text-ink-2">{t("recount.unpublished")}</p>;
  }

  function recount() {
    if (running.current) return;
    running.current = true;
    setState("busy");
    void recountSha256(proof)
      .then((result) => {
        setState(result === "match" ? "match" : result === "mismatch" ? "mismatch" : "failed");
      })
      .catch(() => {
        setState("failed");
      })
      .finally(() => {
        running.current = false;
      });
  }

  return (
    <div className="flex flex-col items-start gap-2 px-4 pb-4">
      <Button type="button" variant="outline" size="sm" aria-busy={state === "busy"} onClick={recount}>
        {t("recount.button")}
      </Button>
      <p
        role="status"
        className={`min-h-6 text-base font-medium text-ink ${state === "mismatch" ? "rounded-sign border border-ink px-3 py-2" : ""}`}
      >
        {state === "busy" ? t("recount.busy") : null}
        {state === "match" ? t("recount.match") : null}
        {state === "mismatch" ? t("recount.mismatch") : null}
        {state === "failed" ? t("recount.failed") : null}
      </p>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PROOF_LABELS, recountSha256, recountUrl, type Proof } from "./proof";

export interface ProofDrawerProps {
  readonly proof: Proof;
  readonly open: boolean;
  /** Called whenever the dialog has closed, however it closed (Escape, Close, the backdrop, or `open` going false). */
  readonly onClose: () => void;
}

/**
 * Where a number comes from: protocol line, script, result file, fingerprints, label. A native modal <dialog>: the
 * browser gives it the top layer, the inert page behind it, Escape and focus containment. It is a drawer at the inline end from
 * 48 rem up and a bottom sheet below. The code is a dynamic import (ProofChip loads it on the first click), so a page
 * with fifty chips ships none of it until someone asks.
 *
 * The caller restores focus in `onClose`: browsers do it on close too, but not when the trigger was re-rendered, and not
 * everywhere.
 */
export function ProofDrawer({ proof, open, onClose }: ProofDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations("states.proof");

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    // The backdrop click is a pointer convenience on top of the two keyboard paths (Escape, the Close button).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- see above
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="m-0 h-dvh max-h-none w-[min(30rem,100vw)] max-w-none border-0 border-s border-edge bg-panel p-0 text-ink ms-auto backdrop:bg-black open:animate-in open:fade-in-0 open:slide-in-from-end-6 open:duration-(--dur-2) max-md:mt-auto max-md:mb-0 max-md:h-auto max-md:max-h-[85dvh] max-md:w-full max-md:border-s-0 max-md:border-t max-md:open:slide-in-from-bottom-6"
    >
      {open ? (
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-hair bg-panel px-4 py-3">
            <h2 id={titleId} className="font-display text-xl font-medium">
              {t("title")}
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.close()}>
              {t("close")}
            </Button>
          </header>
          <DrawerRows proof={proof} />
          <Recount proof={proof} />
        </div>
      ) : null}
    </dialog>
  );
}

function DrawerRows({ proof }: { readonly proof: Proof }) {
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
function Recount({ proof }: { readonly proof: Proof }) {
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

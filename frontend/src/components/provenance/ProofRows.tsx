"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isIncomplete, PROOF_LABELS, recountSha256, recountUrl, type Proof, type ProofLabel } from "./proof";
import type { StoryLine } from "./proof-story";

/*
 * What a proof shows, in two layers (docs/design/redesign-2026-11-17/02b-information-layers.md). `StoryRows` is the plain "Where this
 * number comes from": who made it, about what place and period, how it was counted, what it shows and what it does not. `AuditRows`
 * is the technical record (protocol, script, result file, fingerprints, model, time, the lock), for the few who ask "prove it": it
 * sits under "For auditors", and a field with no value is not printed at all (there is no "Not recorded"). Shared by the drawer and
 * the proof sheet: one place decides what a proof shows.
 */

const STAMP = {
  REAL: "real",
  "REAL weather + assumed crew": "realAssumedCrew",
  SIMULATED: "simulated",
  "DEV 2025": "dev2025",
  RECORDED: "recorded",
} as const satisfies Record<ProofLabel, string>;

/** The plain "Where this number comes from": the stamp, the lines of the story, what the number is, and one sentence if the record is incomplete. */
export function StoryRows({ proof, flush = false }: { readonly proof: Proof; /** No side padding: the sheet aligns it with its own heading. */ readonly flush?: boolean }) {
  const t = useTranslations("states.proof");
  const { story } = proof;
  const tested = proof.evaluation !== undefined;
  // The keys are built by `buildStory` and are looked up dynamically, so the typed key check cannot see them: the unit test renders every
  // family against the English catalogue with a throwing `onError`, which is what proves each key exists.
  const say = t as unknown as (key: string, values?: Readonly<Record<string, string>>) => string;
  const sentence = (line: StoryLine): string => say(`story.${line.key}`, line.values);
  return (
    <div className={`flex flex-col gap-4 py-4 ${flush ? "" : "px-4"}`} data-story="">
      <p data-stamp="" className="w-fit rounded-sign border border-ink px-3 py-1.5 text-sm font-medium text-ink">
        {t(`story.stamp.${STAMP[proof.label]}`)}
        {tested ? ` ${t("story.tested.stamp")}` : ""}
      </p>
      <dl className="flex flex-col">
        {story.rows.map((row) => (
          <div key={row.id} data-story-row={row.id} className="grid gap-1 border-t border-hair py-3 first:border-t-0 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-base font-medium text-ink">{t(`story.rows.${row.id}`)}</dt>
            <dd className="max-w-(--measure) text-base text-ink-2">{row.lines.map(sentence).join(" ")}</dd>
          </div>
        ))}
      </dl>
      {story.note === null ? null : (
        <p data-story-note="" className="max-w-(--measure) text-base text-ink">
          {sentence(story.note)}
        </p>
      )}
      {tested ? (
        <p data-story-tested="" className="max-w-(--measure) text-sm text-ink-2">
          {t("story.tested.note")}
        </p>
      ) : null}
      {isIncomplete(proof) ? (
        <p data-story-incomplete="" className="max-w-(--measure) text-sm text-ink-2">
          {t("story.incomplete")}
        </p>
      ) : null}
    </div>
  );
}

const filled = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

/**
 * The technical record. A field with no value is skipped, never replaced by a placeholder: the rows that remain are all there is.
 * (The label row is the contract's own wording of the label, exactly as the exporter wrote it; the story says it in plain words.)
 */
export function AuditRows({ proof }: { readonly proof: Proof }) {
  const t = useTranslations("states.proof");
  const { evaluation, audit } = proof;
  const fingerprints = [
    { caption: t("sha.file"), value: proof.fileSha256 },
    { caption: t("sha.source"), value: proof.sourceSha256 },
  ].filter((entry): entry is { caption: string; value: string } => filled(entry.value));
  return (
    <dl className="grid gap-4 p-4" data-audit-rows="">
      {filled(proof.protocol) ? (
        <Row name={t("rows.protocol")} code>
          {proof.protocolHref === null ? (
            proof.protocol
          ) : (
            <a href={proof.protocolHref} className="underline" rel="noreferrer">
              {proof.protocol}
            </a>
          )}
        </Row>
      ) : null}
      {filled(proof.script) ? (
        <Row name={t("rows.script")} code>
          {proof.script}
        </Row>
      ) : null}
      {filled(proof.file) ? (
        <Row name={t("rows.file")} code>
          {proof.file}
        </Row>
      ) : null}
      {fingerprints.length === 0 ? null : (
        <Row name={t("rows.sha")}>
          <span className="flex flex-col gap-3">
            {fingerprints.map((entry) => (
              <Hash key={entry.caption} caption={entry.caption} value={entry.value} />
            ))}
          </span>
        </Row>
      )}
      <Row name={t("rows.label")}>{t(`labels.${PROOF_LABELS[proof.label]}`)}</Row>
      {audit?.policy === undefined ? null : (
        <Row name={t("audit.policy")} code>
          {audit.policy.threshold === undefined ? audit.policy.code : `${audit.policy.code}, ${audit.policy.threshold}`}
        </Row>
      )}
      {audit?.verdicts === undefined || audit.verdicts.length === 0 ? null : (
        <Row name={t("audit.verdicts")} code>
          <span className="flex flex-col gap-2">
            {audit.verdicts.map((sentence) => (
              <span key={sentence}>{sentence}</span>
            ))}
          </span>
        </Row>
      )}
      {evaluation === undefined ? null : (
        <Row name={t("rows.lock")}>
          <span className="flex flex-col gap-3">
            <span className="text-base text-ink">{t("lock.note")}</span>
            <Hash caption={t("lock.hash")} value={evaluation.lockSha256} />
            <Hash caption={t("lock.protocolCommit")} value={evaluation.protocolCommit} />
          </span>
        </Row>
      )}
      {evaluation === undefined ? null : (
        <Row name={t("rows.amendments")}>
          <span className="flex flex-col gap-3" data-amendments="">
            <span className="text-base text-ink">{t("lock.amendmentsNote")}</span>
            {evaluation.amendments.map((amendment) => (
              <Hash key={amendment.path} caption={`${amendment.path.split("/").pop() ?? amendment.path} (${amendment.commit.slice(0, 7)})`} value={amendment.sha256} />
            ))}
            <Hash caption={`${evaluation.freeze.path.split("/").pop() ?? evaluation.freeze.path} (${evaluation.freeze.commit.slice(0, 7)})`} value={evaluation.freeze.sha256} />
          </span>
        </Row>
      )}
      {filled(proof.modelId) ? (
        <Row name={t("rows.model")} code>
          {proof.modelId}
        </Row>
      ) : null}
      {filled(proof.generatedAt) ? (
        <Row name={t("rows.generated")} code>
          {proof.generatedAt}
        </Row>
      ) : null}
    </dl>
  );
}

/**
 * "For auditors": the technical record behind a closed `<details>`, clearly a different place (its own heading and surface, mono
 * type). It opens itself when the page is reached by an `#audit` link (the drawer's "For auditors" link), because a browser does not
 * open a closed `<details>` for a fragment that names the `<details>` itself.
 */
export function AuditDetails({ children }: { readonly children: ReactNode }) {
  const t = useTranslations("states.proof");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#audit") setOpen(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  return (
    <details
      id="audit"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      className="scroll-mt-20 rounded-sign border border-hair bg-panel"
    >
      <summary className="flex min-h-(--target) cursor-pointer items-center px-4 py-3 font-display text-lg font-medium text-ink">{t("audit.heading")}</summary>
      <div className="border-t border-hair">
        <p className="max-w-(--measure) px-4 pt-4 text-sm text-ink-2">{t("audit.intro")}</p>
        {children}
      </div>
    </details>
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

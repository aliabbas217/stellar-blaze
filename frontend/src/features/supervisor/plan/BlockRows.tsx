"use client";

import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { PlanSwatch, type PlanBlockState } from "@/components/plan/PlanBars";
import { formatClock } from "@/components/spine/geometry";
import type { PlanBlock } from "@/features/supervisor/plan/plan-model";
import { CLAIMS_ENGLISH } from "@/i18n/claims-english";
import { sanitizeClause } from "@/lib/copy/sanitize-clause";

/*
 * Every block of the plan as a row (F2 Task 20, critique fix 5): the chart's blocks are 4 to 22 px wide, so what a supervisor
 * reads and touches is here, each row at least 44 px tall. Time, what the crew does, and on expand the clause behind the block
 * and the rule's id (an identifier, shown for the audit, in the mono face). A native button per row (aria-expanded and
 * aria-controls), never an SVG shape.
 *
 * The current block carries `aria-current="time"` and a "Now" tag; blocks that have ended are quieter. The clause is the API's
 * text and is shown as sent, less the internal ADR references the ruleset keeps in it (sanitizeClause: the law's words are untouched); a block whose clause is empty says so rather than showing nothing.
 */

const bdi = (chunks: ReactNode): ReactNode => <bdi>{chunks}</bdi>;

const STATE_KEY: Record<PlanBlockState, "work" | "adoshRest" | "art18Break" | "ban" | "stopped" | "off"> = {
  work: "work",
  adosh_rest: "adoshRest",
  art18_break: "art18Break",
  ban: "ban",
  stopped: "stopped",
  off: "off",
};

function Row({ block, current, past }: { readonly block: PlanBlock; readonly current: boolean; readonly past: boolean }) {
  const t = useTranslations("supervisor.plan");
  const [open, setOpen] = useState(false);
  const panel = useId();
  const state = t(`state.${STATE_KEY[block.state]}`);
  return (
    <li
      data-block={block.state}
      {...(current ? { "aria-current": "time" as const, "data-current": "" } : {})}
      className={`border-b border-hair ${current ? "border-s-3 border-s-signal bg-panel ps-2" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={`flex min-h-11 w-full touch-manipulation items-center gap-3 text-start text-base ${past ? "text-ink-3" : "text-ink"}`}
      >
        <PlanSwatch state={block.state} />
        <span data-time-label="" className="min-w-[8.5em] tabular-nums">
          {t.rich("blocks.range", { from: formatClock(block.fromMin / 60), to: formatClock(block.toMin / 60), bdi })}
        </span>
        <span className="min-w-0 flex-1 font-medium">{state}</span>
        {current ? <span className="shrink-0 text-sm font-semibold text-ink">{t("blocks.now")}</span> : null}
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-4 shrink-0 text-ink-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          <path d="M5 9l7 7 7-7" stroke="currentColor" strokeWidth="2.5" fill="none" />
        </svg>
      </button>
      <div id={panel} hidden={!open} className="flex flex-col gap-1 pb-3 ps-8 text-sm leading-(--sign-leading-text) text-ink-2">
        {/* The clause is the API's English text of the law, whatever the page's language: an English (LTR) block. The "no clause" line is ours and keeps the page's language. */}
        <p {...(block.clause === "" ? {} : CLAIMS_ENGLISH)}>{block.clause === "" ? t("blocks.noClause") : sanitizeClause(block.clause)}</p>
        <p>
          {t("blocks.rule")} <code dir="ltr" translate="no" className="font-mono text-ink-2">{block.ruleId}</code>
        </p>
      </div>
    </li>
  );
}

export function BlockRows({ blocks, currentIndex, nowMin }: { readonly blocks: readonly PlanBlock[]; readonly currentIndex: number; readonly nowMin: number | null }) {
  const t = useTranslations("supervisor.plan");
  return (
    <div className="flex flex-col gap-1 px-4 pt-4" data-block-rows="">
      <h2 className="text-base font-medium text-ink-3">{t("blocks.heading")}</h2>
      <ul className="m-0 flex list-none flex-col border-t border-hair p-0">
        {blocks.map((block) => (
          <Row key={`${block.startsAt}-${block.state}`} block={block} current={block.index === currentIndex} past={nowMin !== null && block.toMin <= nowMin} />
        ))}
      </ul>
    </div>
  );
}

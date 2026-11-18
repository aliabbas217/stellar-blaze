"use client";

import { useTranslations } from "next-intl";
import type { components } from "@/api/schema";

type Crew = components["schemas"]["Crew"];

/*
 * The crews table of the safety view, loaded on demand by HseView (a chunk of its own: the route is held to the 170 KB budget, and the table is
 * only needed once the crews have arrived). One row per crew: its name and task, its plan (signed, not signed, or changed since it was signed)
 * and whether its work is stopped. Nothing here is about any one worker.
 */

function planKey(state: Crew["signoff_state"]): "signed" | "unsigned" | "changed" {
  return state === "changed_since_signed" ? "changed" : state;
}

export default function HseTable({ crews }: { readonly crews: readonly Crew[] }) {
  const t = useTranslations("hse");
  return (
    <table data-crews="" className="w-full border-collapse text-start text-base">
      <caption className="sr-only">{t("table.caption")}</caption>
      <thead>
        <tr className="border-b border-edge text-sm text-ink-2">
          <th scope="col" className="py-2 pe-2 text-start font-medium">
            {t("table.crew")}
          </th>
          <th scope="col" className="px-2 py-2 text-start font-medium">
            {t("table.plan")}
          </th>
          <th scope="col" className="py-2 ps-2 text-start font-medium">
            {t("table.work")}
          </th>
        </tr>
      </thead>
      <tbody>
        {crews.map((crew) => (
          <tr key={crew.id} data-crew={crew.id} data-stopped={String(crew.stopped)} className="border-b border-hair align-top">
            <th scope="row" className="py-3 pe-2 text-start font-semibold text-ink">
              <bdi>{crew.name}</bdi>
              <span className="block text-sm font-normal text-ink-2">
                <bdi>{crew.task_label}</bdi>
              </span>
            </th>
            <td className="px-2 py-3 text-ink">{t(`plan.${planKey(crew.signoff_state)}`)}</td>
            <td className="py-3 ps-2 text-ink">
              {/* A filled square for a stop and an empty one for none: told apart by shape and words, never by colour alone. */}
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`size-2.5 flex-none border border-ink ${crew.stopped ? "bg-ink" : ""}`} />
                <span className={crew.stopped ? "font-semibold" : ""}>{t(crew.stopped ? "work.stopped" : "work.running")}</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

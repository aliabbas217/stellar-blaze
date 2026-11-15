"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { ACTION_SECONDARY } from "@/components/states/actions";
import { loadFieldFiles, type LoadedField } from "./field-load";
import type { FieldPanelProps } from "./FieldPoster";
import { FieldStage } from "./FieldStage";

/*
 * Brings the live field in after first paint. The server HTML holds the poster (`children`: stage, readout, spine, all at their
 * final size); this component starts the island chunk and the two data files at once when the page is hydrated, and swaps the
 * island in when both are here. If either fails the poster gives way to the error state: what failed, and the way to the
 * scoreboard, which does not need the field. The island is a dynamic import so the landing's first load stays small.
 */

type IslandModule = ComponentType<{ readonly panel: FieldPanelProps; readonly data: LoadedField }>;

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly Island: IslandModule; readonly data: LoadedField }
  | { readonly kind: "failed" };

export function FieldGate({ panel, children }: { readonly panel: FieldPanelProps; readonly children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    Promise.all([import("./FieldIsland"), loadFieldFiles()]).then(
      ([module, data]) => {
        if (live) setState({ kind: "ready", Island: module.FieldIsland, data });
      },
      () => {
        if (live) setState({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "ready") return <state.Island panel={panel} data={state.data} />;
  if (state.kind === "failed") return <FieldFailed />;
  return <>{children}</>;
}

function FieldFailed() {
  const t = useTranslations("judge.landing.field.error");
  return (
    <FieldStage picture={false}>
      <div role="alert" className="absolute inset-0 z-10 grid content-center justify-items-start gap-3 p-6 min-[900px]:ps-[55%]">
        <h2 className="font-display text-xl font-medium text-ink">{t("title")}</h2>
        <p className="max-w-(--measure) text-base text-ink-2">{t("reason")}</p>
        <FieldLink href="/replay" className={ACTION_SECONDARY}>
          {t("primary")}
        </FieldLink>
      </div>
    </FieldStage>
  );
}

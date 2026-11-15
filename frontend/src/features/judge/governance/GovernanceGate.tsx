"use client";

import type { ReactNode } from "react";
import { useIslandGate } from "@/features/judge/live/useIslandGate";
import type { GovernanceIslandProps } from "./GovernanceIsland";
import type { RecordedView } from "./recorded-view";

/*
 * Wraps the server-rendered `GovernanceStatic` and swaps in the interactive island on the first interaction with a control.
 * This file must stay free of TanStack Query and the demo context: the island is only ever reached through the dynamic
 * `import()` below (tests/unit/lint/island-graph.test.ts fails if a first-load module reaches `@tanstack/*`).
 */
const loadIsland = () => import("./GovernanceIsland");

export function GovernanceGate({ recorded, children }: { readonly recorded: RecordedView | null; readonly children: ReactNode }) {
  const gate = useIslandGate<GovernanceIslandProps>(loadIsland);
  if (gate.Island !== null) {
    const Island = gate.Island;
    return <Island recorded={recorded} {...gate.handoff} />;
  }
  return (
    <div className="contents" {...gate.handlers}>
      {children}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import type { BanState } from "@/components/spine/ban-state";
import { useIslandGate, type IslandProps } from "@/features/judge/live/useIslandGate";
import type { TryViewProps } from "./TryPlanView";
import type { RecordedPlanView } from "./view";

/*
 * Wraps the server-rendered `TryStatic` and swaps in the interactive island on the first interaction with a control. This file
 * must stay free of TanStack Query and the demo context: the island is only reached through the dynamic `import()` below
 * (tests/unit/lint/island-graph.test.ts fails if a first-load module reaches `@tanstack/*`).
 */
const loadIsland = () => import("./TryIsland");

export interface TryGateProps {
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  readonly dateLabel: string;
  readonly recorded: RecordedPlanView | null;
  readonly children: ReactNode;
}

export function TryGate({ heat, ban, dateLabel, recorded, children }: TryGateProps) {
  const gate = useIslandGate<TryViewProps & IslandProps>(loadIsland);
  if (gate.Island !== null) {
    const Island = gate.Island;
    return <Island heat={heat} ban={ban} dateLabel={dateLabel} recorded={recorded} {...gate.handoff} />;
  }
  return (
    <div className="contents" {...gate.handlers}>
      {children}
    </div>
  );
}

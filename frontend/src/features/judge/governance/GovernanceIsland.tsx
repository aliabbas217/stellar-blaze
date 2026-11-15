"use client";

import { DemoProvider } from "@/features/demo/DemoProvider";
import type { IslandProps } from "@/features/judge/live/useIslandGate";
import { QueryProvider } from "@/providers/QueryProvider";
import { GovernanceView } from "./GovernanceView";
import type { RecordedView } from "./recorded-view";

/** The lazy chunk of `/replay/governance`: the query client, the demo context and the interactive view. */
export interface GovernanceIslandProps extends IslandProps {
  readonly recorded: RecordedView | null;
}

export default function GovernanceIsland({ recorded, initialAction, restoreFocus }: GovernanceIslandProps) {
  return (
    <QueryProvider>
      <DemoProvider>
        <GovernanceView recorded={recorded} initialAction={initialAction} restoreFocus={restoreFocus} />
      </DemoProvider>
    </QueryProvider>
  );
}

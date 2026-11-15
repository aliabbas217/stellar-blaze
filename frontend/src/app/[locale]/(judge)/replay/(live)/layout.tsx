import type { ReactNode } from "react";

/*
 * The two judge pages that call the API (`replay/try` and `replay/governance`). The route group `(live)` adds no URL segment
 * and mounts NOTHING: TanStack Query and the demo context are a lazy island each page loads on the first interaction with
 * its controls (features/judge/live/useIslandGate.ts), so neither is in the first-load JS (route budget 174,080 B gzip).
 * Do not add a provider here: it would put TanStack Query back on both routes (tests/unit/lint/island-graph.test.ts).
 */
export default function ReplayLiveLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

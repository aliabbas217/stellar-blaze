import { DemoModeSwitch } from "@/components/shell/DemoModeSwitch";
import { ResetDemoButton } from "@/components/shell/ResetDemoButton";
import { GovernanceLayout } from "./GovernanceLayout";
import type { RecordedView } from "./recorded-view";
import { deriveRun } from "./run";

/*
 * The SERVER-RENDERED first paint of `/replay/governance`: the recorded run, a completed four-step sequence, with plain
 * buttons for the three controls. No TanStack Query, no demo context and no client component of the page's own is in this
 * tree, so none of it is in the route's first-load JS (the route budget, 174,080 B gzip). `GovernanceGate` wraps it and loads
 * the interactive island on the first tap or focus on a control; until then the page never calls the API.
 */
export function GovernanceStatic({ recorded }: { readonly recorded: RecordedView | null }) {
  return (
    <GovernanceLayout
      run={deriveRun({ recorded, live: null, lastRun: null, apiRows: [], pending: false })}
      recorded={recorded}
      siteName={null}
      siteId={undefined}
      pending={false}
      logFetching={false}
      sentBefore={false}
      modeSwitch={<DemoModeSwitch value="replay" liveUnavailable={false} />}
      reset={
        <div className="flex flex-col gap-2 font-body text-sm text-ink">
          <ResetDemoButton />
          <p role="status" />
        </div>
      }
    />
  );
}

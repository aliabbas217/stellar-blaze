import { useLocale } from "next-intl";
import type { BanState } from "@/components/spine/ban-state";
import { DemoModeSwitch } from "@/components/shell/DemoModeSwitch";
import { TryPlanLayout } from "./TryPlanLayout";
import { DEFAULT_ACCLIMATISED, DEFAULT_DAYS_PER_WEEK } from "./request";
import { templateRuns } from "./runs";
import type { RecordedPlanView } from "./view";

/*
 * The SERVER-RENDERED first paint of `/replay/try`: the common roster on the replay day's heat, the three templates and the two
 * crew assumptions as plain controls, and the check button. No TanStack Query, no demo context and no client component of the
 * page's own is in this tree, so none of it is in the route's first-load JS (the route budget, 174,080 B gzip). `TryGate` wraps it
 * and loads the interactive island on the first tap or focus on a control; until then the page never calls the API.
 */
export function TryStatic({
  heat,
  ban,
  dateLabel,
  recorded,
}: {
  readonly heat: readonly (string | null)[];
  readonly ban: BanState;
  readonly dateLabel: string;
  readonly recorded: RecordedPlanView | null;
}) {
  const locale = useLocale();
  return (
    <TryPlanLayout
      phase="idle"
      runs={templateRuns("common")}
      rowProblems={[null, null, null]}
      templateId="common"
      acclimatised={DEFAULT_ACCLIMATISED}
      daysPerWeek={DEFAULT_DAYS_PER_WEEK}
      daysProblem={false}
      heat={heat}
      ban={ban}
      dateLabel={dateLabel}
      siteName={null}
      answer={null}
      invalidLines={[]}
      requestId={null}
      recorded={recorded}
      showRecorded={false}
      locale={locale}
      modeSwitch={<DemoModeSwitch value="replay" liveUnavailable={false} />}
    />
  );
}

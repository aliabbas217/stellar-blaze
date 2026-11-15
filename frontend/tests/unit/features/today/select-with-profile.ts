import type { components } from "@/api/schema";
import type { Profile } from "@/features/profile/profile-shape";
import { personalPartFor } from "@/features/today/personal-level";
import { selectTodayViewModel, type TodayViewModel } from "@/features/today/useSiteToday";

type RiskPolicy = components["schemas"]["RiskPolicy"];
type SiteForecastToday = components["schemas"]["SiteForecastToday"];

/**
 * The whole Today view model from the four things the tests hold (forecast, policy, profile, clock): the site side of
 * `selectTodayViewModel` with the on-device pipeline of personal-level.ts injected, as `useSiteToday` assembles them.
 */
export function selectWithProfile(input: {
  forecast: SiteForecastToday;
  policy: RiskPolicy | undefined;
  profile: Profile | null;
  now: Date;
}): TodayViewModel {
  const { policy, profile } = input;
  return selectTodayViewModel({
    forecast: input.forecast,
    now: input.now,
    personal: (context) => personalPartFor({ ...context, profile, policy }),
  });
}

import type { components } from "@/api/schema";
import { isCalendarDate, localCalendarDate, type Profile } from "@/features/profile/profile-shape";
import { useProfile } from "@/features/profile/store";
import { personalLevel, policyMatchesForecast } from "@/features/risk/personal";
import type { PersonalPart, PersonalStatus, PersonalUnavailableReason } from "@/features/today/useSiteToday";

/*
 * The on-device personal level, as ONE lazily loaded module (F2 W1, the route script budget). Everything that is only needed by
 * a phone that holds a profile is imported here and nowhere on Today's first load: the profile store (zustand, its persist
 * middleware, `revoke`), the NIOSH limits, the exceedance maths and the profile's validation. `useSiteToday` imports this file
 * dynamically, after the first paint, and only when the phone says it holds a profile (`useHasProfile`, which reads storage
 * without the store). Personal risk is worked out on the phone and never sent anywhere (ADR 0004).
 */

type HourForecast = components["schemas"]["HourForecast"];
type RiskPolicy = components["schemas"]["RiskPolicy"];

function unavailable(reason: PersonalUnavailableReason): PersonalStatus {
  return { status: "unavailable", reason };
}

/**
 * The personal verdict for the hour that contains now, with the policy versions for the screen. `hour` null means the forecast
 * does not cover now. No policy yet is "policy-unavailable"; a policy of another config_version is "version-mismatch" and asks
 * for a refetch (ADR 0010); a start date that is not a date cannot be computed and must not blank the screen (the site level
 * still shows).
 */
export function personalPartFor(input: {
  readonly hour: HourForecast | null;
  readonly profile: Profile | null;
  readonly policy: RiskPolicy | undefined;
  readonly forecast: components["schemas"]["SiteForecastToday"];
  readonly now: Date;
}): PersonalPart {
  const { hour, profile, policy, forecast, now } = input;
  const policyVersions = policy === undefined ? null : { version: policy.version, configVersion: policy.config_version };
  const needsPolicyRefetch = policy !== undefined && !policyMatchesForecast(forecast, policy);
  const part = (personal: PersonalStatus): PersonalPart => ({ personal, policy: policyVersions, needsPolicyRefetch });

  if (profile === null) return part(unavailable("no-profile"));
  if (hour === null) return part(unavailable("outside-forecast"));
  const { p05, p50, p95 } = hour.wbgt_c;
  if (p05 === null || p50 === null || p95 === null) return part(unavailable("no-hour-data"));
  if (policy === undefined) return part(unavailable("policy-unavailable"));
  if (needsPolicyRefetch) return part(unavailable("version-mismatch"));
  if (!isCalendarDate(profile.heatWorkStartDate)) return part(unavailable("not-computable"));
  const value = personalLevel({ hour, profile, policy, today: localCalendarDate(now) });
  return part(value === null ? unavailable("not-computable") : { status: "available", value });
}

/** The profile store, for `useSyncExternalStore`: the screen re-renders when the worker's profile is saved or revoked. */
export function subscribeProfile(onChange: () => void): () => void {
  return useProfile.subscribe(onChange);
}

export function getProfile(): Profile | null {
  return useProfile.getState().profile;
}

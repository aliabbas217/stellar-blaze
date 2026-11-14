import { useTranslations } from "next-intl";

/**
 * "Synthetic demo site: no real people, no real data", with the demo site's name (ADR 0062, F2 decision D4). It sits on
 * every screen where a visitor can act (supervisor crews, plan and sign-off, governance, try a plan) so nobody mistakes
 * the demo for a live deployment. Presentational and shared: it takes the name as a prop and imports no feature. Plain
 * ink on the panel: it is a notice, not an alarm, and carries no level colour.
 */
export function SyntheticDemoBanner({ siteName }: { siteName: string | null }) {
  const t = useTranslations("shell.demo");

  return (
    <div role="note" className="border-b border-edge bg-panel px-4 py-2 sm:px-6 font-body text-sm text-ink">
      <p className="font-semibold">{t("banner")}</p>
      {siteName === null ? null : (
        <p className="text-ink-2">
          <bdi>{siteName}</bdi>
        </p>
      )}
    </div>
  );
}

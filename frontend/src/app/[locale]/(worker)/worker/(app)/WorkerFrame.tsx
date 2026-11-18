"use client";

import { useLocale } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { FieldShell } from "@/components/shell/FieldShell";
import { splitDemoName } from "@/components/shell/site-name";
import type { ChangeCrew } from "@/components/shell/SettingsSheet";
import { WorkerDock } from "@/components/shell/WorkerDock";
import { DemoClock } from "@/features/demo/DemoClock";
import { useDemo } from "@/features/demo/DemoProvider";
import { joinHref } from "@/features/join/link";
import { useSitePin } from "@/features/profile/site-pin";
import { getPathname } from "@/i18n/navigation";

/*
 * Glue between the worker routes and the presentational field shell: the site the phone is pinned to, the demo clock and
 * the worker dock. Lives beside the layout because it may import worker code, which the shared shell may not.
 *
 * A phone with no pin says so ("No site chosen"): naming the demo site there, beside "Scan your crew's code", would claim a
 * site the worker has not chosen. A pinned site whose name the site list cannot give (it failed to load) shows its id: a
 * truthful line beats a blank or a claim that nothing is chosen.
 *
 * It reads the pin through `useSitePin`, a reader with no profile store behind it, and runs no query of its own: the crew's
 * name arrives from the page that has the crew's timeline (`useFieldCrewLabel`). Both keep the profile store and an extra
 * request out of the layout of every worker page (F2 Part 0, the route script budget).
 *
 * "Change crew" (settings sheet): opens the join page (`/worker/join`, redesign S6a), where the worker finds the site and the crew. The link
 * first lets go of the pin as the page leaves (the profile store is loaded only now, on the tap, as chooseDeviceSite does), so that Today
 * does not hold the old choice while the worker picks another. Nothing else on the phone is touched.
 */
export function WorkerFrame({ children }: { children: ReactNode }) {
  const pin = useSitePin();
  const { sites } = useDemo();
  const locale = useLocale();
  const site = sites.find((candidate) => candidate.id === pin?.siteId) ?? null;
  const { name, demo } = site === null ? { name: pin?.siteId ?? null, demo: false } : splitDemoName(site.name, site.synthetic);
  const changeCrew = useMemo<ChangeCrew>(
    () => ({
      href: getPathname({ href: joinHref(), locale }),
      onActivate: async () => {
        // The store is loaded now, so the pin can be dropped synchronously at the last moment: when this page is leaving. Dropped sooner
        // it is undone at once: Today pins whatever `?site=` the address still names, and re-pins a phone that has none. `setState` (not
        // `clearSite`) writes the same stored value without announcing the change to this page, so nothing here re-renders and re-pins
        // in the instant before it unloads.
        const { useProfile } = await import("@/features/profile/store");
        window.addEventListener(
          "pagehide",
          () => {
            useProfile.setState({ site: null });
          },
          { once: true },
        );
      },
    }),
    [locale],
  );

  return (
    <FieldShell siteName={name} demo={demo} changeCrew={changeCrew} clock={<DemoClock />} dock={<WorkerDock />}>
      {children}
    </FieldShell>
  );
}

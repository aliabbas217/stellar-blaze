"use client";

import type { ReactNode } from "react";
import { FieldShell } from "@/components/shell/FieldShell";
import { splitDemoName } from "@/components/shell/site-name";
import { DemoClock } from "@/features/demo/DemoClock";
import { useDemo } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { usePathname } from "@/i18n/navigation";

/*
 * Glue between the supervisor routes and the presentational field shell: the demo site, the demo clock and the mode
 * switch. No dock (the supervisor's Stop work bar belongs to the crew screens). Imports no worker code: a supervisor
 * gets the site from the demo context, never from the worker's on-device pin.
 */
export function SupervisorFrame({ children }: { children: ReactNode }) {
  const { site } = useDemo();
  // A crew's plan always has a site name and a crew name: the header keeps their height from the first paint (no shift when they arrive).
  const crewScreen = usePathname().includes("/supervisor/crews/");
  const { name, demo } = site === null ? { name: null, demo: false } : splitDemoName(site.name, site.synthetic);

  return (
    <FieldShell siteName={name} demo={demo} reserveLabels={crewScreen} clock={<DemoClock />}>
      <div className="border-b border-hair px-4 py-2">
        <DemoSwitch />
      </div>
      {children}
    </FieldShell>
  );
}

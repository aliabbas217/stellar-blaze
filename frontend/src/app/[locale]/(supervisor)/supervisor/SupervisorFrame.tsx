"use client";

import type { ReactNode } from "react";
import { FieldShell } from "@/components/shell/FieldShell";
import { RoleBadge } from "@/components/shell/RoleBadge";
import { DemoClock } from "@/features/demo/DemoClock";
import { useDemo } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { usePathname } from "@/i18n/navigation";

/*
 * Glue between the supervisor routes and the presentational field shell: the demo site, the demo clock, the mode
 * switch and the demo role badge (a label and "Switch role": it gates nothing, so a deep link works with no role chosen).
 * No dock (the supervisor's Stop work bar belongs to the crew screens). Imports no worker code: a supervisor
 * gets the site from the demo context, never from the worker's on-device pin.
 */
export function SupervisorFrame({ children }: { children: ReactNode }) {
  const { site } = useDemo();
  const pathname = usePathname();
  // A crew's plan always has a site name and a crew name: the header keeps their height from the first paint (no shift when they arrive).
  const crewScreen = pathname.includes("/supervisor/crews/");
  // The role entry is where the role is chosen: it carries its own "Choose another role", so the strip is left off it.
  const entry = pathname.endsWith("/supervisor/enter");

  return (
    <FieldShell siteName={site?.name ?? null} reserveLabels={crewScreen} clock={<DemoClock />}>
      {entry ? null : (
        <div className="flex flex-wrap items-start justify-between gap-x-3 border-b border-hair px-4 py-2">
          <DemoSwitch />
          <RoleBadge />
        </div>
      )}
      {children}
    </FieldShell>
  );
}

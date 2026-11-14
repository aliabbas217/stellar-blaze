"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { crewsQueryOptions } from "@/api/queries";
import { FieldShell } from "@/components/shell/FieldShell";
import { WorkerDock } from "@/components/shell/WorkerDock";
import { DemoClock } from "@/features/demo/DemoClock";
import { useDemo } from "@/features/demo/DemoProvider";
import { useDeviceSite } from "@/features/profile/useDeviceSite";

/*
 * Glue between the worker routes and the presentational field shell: the site and crew the phone is pinned to (the
 * device pin, falling back to the demo site), the demo clock and the worker dock. Lives beside the layout because it may
 * import worker code, which the shared shell may not.
 */
export function WorkerFrame({ children }: { children: ReactNode }) {
  const pin = useDeviceSite();
  const { site: demoSite, sites } = useDemo();
  const site = sites.find((candidate) => candidate.id === pin.siteId) ?? demoSite;

  const crews = useQuery({ ...crewsQueryOptions(site?.id ?? ""), enabled: site !== null && pin.crewId !== null });
  // Only the crew's name: the task label is shown to the crew's own supervisor (the contract says so).
  const crewLabel = crews.data?.find((crew) => crew.id === pin.crewId)?.name ?? null;

  return (
    <FieldShell siteName={site?.name ?? null} crewLabel={crewLabel} clock={<DemoClock />} dock={<WorkerDock />}>
      {children}
    </FieldShell>
  );
}

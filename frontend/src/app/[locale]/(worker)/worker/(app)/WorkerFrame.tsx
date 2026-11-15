"use client";

import type { ReactNode } from "react";
import { FieldShell } from "@/components/shell/FieldShell";
import { WorkerDock } from "@/components/shell/WorkerDock";
import { DemoClock } from "@/features/demo/DemoClock";
import { useDemo } from "@/features/demo/DemoProvider";
import { useSitePin } from "@/features/profile/site-pin";

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
 */
export function WorkerFrame({ children }: { children: ReactNode }) {
  const pin = useSitePin();
  const { sites } = useDemo();
  const site = sites.find((candidate) => candidate.id === pin?.siteId) ?? null;

  return (
    <FieldShell siteName={site?.name ?? pin?.siteId ?? null} clock={<DemoClock />} dock={<WorkerDock />}>
      {children}
    </FieldShell>
  );
}

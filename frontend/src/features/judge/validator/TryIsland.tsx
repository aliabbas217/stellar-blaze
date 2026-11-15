"use client";

import { DemoProvider } from "@/features/demo/DemoProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { TryPlanView, type TryViewProps } from "./TryPlanView";

/** The lazy chunk of `/replay/try`: the query client, the demo context and the interactive view. */
export default function TryIsland(props: TryViewProps) {
  return (
    <QueryProvider>
      <DemoProvider>
        <TryPlanView {...props} />
      </DemoProvider>
    </QueryProvider>
  );
}

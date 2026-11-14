import type { ReactNode } from "react";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { DemoSwitch } from "@/features/demo/DemoSwitch";
import { QueryProvider } from "@/providers/QueryProvider";

/*
 * The two judge pages that call the API (`replay/try` and `replay/governance`): TanStack Query and the demo context are
 * mounted here and only here, so the rest of the judge pages stay static. The route group `(live)` adds no URL segment.
 */
export default function ReplayLiveLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <DemoProvider>
        <div className="flex justify-end border-b border-hair px-4 py-2 sm:px-6">
          <DemoSwitch />
        </div>
        {children}
      </DemoProvider>
    </QueryProvider>
  );
}

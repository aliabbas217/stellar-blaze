"use client";

import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { DemoSwitch } from "@/features/demo/DemoSwitch";

/*
 * What sits inside the safety view's Demo controls: the Replay or Live switch and Reset demo site. A module of its own so its script (the reset
 * mutation, the forecast read behind the switch) loads only when someone opens the section: the safety view is held to the plain 170 KB route
 * budget, and no one needs these to read the crews.
 */
export default function DemoControlsBody({ siteId }: { readonly siteId: string | null }) {
  return (
    <>
      <DemoSwitch />
      <ResetDemoControl siteId={siteId ?? undefined} />
    </>
  );
}

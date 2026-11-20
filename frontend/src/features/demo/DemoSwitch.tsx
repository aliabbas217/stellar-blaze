"use client";

import { useEffect } from "react";
import { DemoModeSwitch } from "@/components/shell/DemoModeSwitch";
import { useDemo } from "@/features/demo/DemoProvider";
import { useForecastMode } from "@/features/demo/useClock";

/**
 * The mode switch wired to the demo context. The forecast's own `mode` stamp says what the deployment serves (never the
 * switch): a deployment that answers `replay` has no live feed, so Live is shown disabled with a plain line saying so, and a
 * Live choice that is already held (a stored choice, an old link) is put back to Replay so the page never claims a mode it is
 * not in. A deployment that answers `live` leaves both buttons usable: the capability is kept, only not offered when absent.
 */
export function DemoSwitch() {
  const { demo, setDemo } = useDemo();
  const answered = useForecastMode();
  const liveUnavailable = answered === "replay";
  useEffect(() => {
    if (liveUnavailable && demo === "live") setDemo("replay");
  }, [liveUnavailable, demo, setDemo]);
  return <DemoModeSwitch value={demo} onChange={setDemo} liveUnavailable={liveUnavailable} />;
}

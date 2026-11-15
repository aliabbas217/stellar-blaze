"use client";

import { DemoModeSwitch } from "@/components/shell/DemoModeSwitch";
import { useDemo } from "@/features/demo/DemoProvider";
import { useForecastMode } from "@/features/demo/useClock";

/**
 * The mode switch wired to the demo context. It shows the mode the visitor asked for, and says "Live is not running on
 * this deployment" when a Live request was answered with a replay: that comes from the forecast's own `mode` stamp, never
 * from the switch.
 */
export function DemoSwitch() {
  const { demo, setDemo } = useDemo();
  const answered = useForecastMode();
  return <DemoModeSwitch value={demo} onChange={setDemo} liveUnavailable={demo === "live" && answered === "replay"} />;
}

"use client";

import { useTranslations } from "next-intl";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useDemo } from "@/features/demo/DemoProvider";

/** Loaded when the Demo controls are first opened, not before (the route budget). */
const DemoControlsBody = lazy(() => import("./DemoControlsBody"));

/** The anchor of the demo controls: the tour links to it. */
export const DEMO_CONTROLS_ID = "demo-controls";

/**
 * The demo scaffolding (Replay or Live, Reset demo site), out of the way: a closed disclosure with a 44 px summary. It opens by itself when
 * the page is opened at `#demo-controls` (the tour links there), because a browser does not open a closed <details> for its own id.
 */
export function DemoControls() {
  const t = useTranslations("hse");
  const siteId = useDemo().site?.id ?? null;
  const details = useRef<HTMLDetailsElement>(null);
  const [opened, setOpened] = useState(false);
  // The DOM is the external system here: open the element the address names (the section is otherwise uncontrolled, so a tap on its summary just works).
  useEffect(() => {
    if (window.location.hash === `#${DEMO_CONTROLS_ID}`) details.current?.setAttribute("open", "");
  }, []);

  return (
    <details
      ref={details}
      id={DEMO_CONTROLS_ID}
      data-demo-controls=""
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
      className="rounded-card bg-panel inset-ring-[1.5px] inset-ring-hair"
    >
      <summary className="flex min-h-(--target) cursor-pointer items-center px-4 font-semibold text-ink">{t("demo.title")}</summary>
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        {opened ? (
          <Suspense fallback={null}>
            <DemoControlsBody siteId={siteId} />
          </Suspense>
        ) : null}
      </div>
    </details>
  );
}

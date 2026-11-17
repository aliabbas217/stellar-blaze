import { useTranslations } from "next-intl";
import { CHIP } from "@/components/states/actions";

/*
 * The mode is declared here, not imported from the demo feature: shared code never imports a feature (eslint.config.mjs).
 * The feature's `DemoMode` is the same union, so the glue passes its value and setter straight in.
 */
type DemoMode = "live" | "replay";

const MODES = ["replay", "live"] as const;

/**
 * The mode switch: Replay (a recorded day) or Live. It shows the mode the visitor ASKED for; the mode the data IS comes
 * from the forecast response (its `mode` stamp), and when a Live request is answered with a replay, the caller sets
 * `liveUnavailable` and the switch says so in words ("Live is not running on this deployment"), never silently
 * showing a replay as live. Presentational: the state lives in the demo context (`?demo=`).
 *
 * It has no `"use client"` on purpose: a server page can render it with NO `onChange` (the buttons then carry
 * `data-island-action="demo-<mode>"` so a gate can load the interactive island on the first tap, see
 * features/judge/live/useIslandGate). A client caller passes the handler.
 */
export function DemoModeSwitch({
  value,
  onChange,
  liveUnavailable,
}: {
  value: DemoMode;
  onChange?: (mode: DemoMode) => void;
  liveUnavailable: boolean;
}) {
  const t = useTranslations("shell.demo.mode");

  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label={t("label")} className="inline-flex gap-2">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            data-island-action={`demo-${mode}`}
            {...(onChange === undefined
              ? {}
              : {
                  onClick: () => {
                    onChange(mode);
                  },
                })}
            className={`${CHIP} min-w-(--target) px-3 font-body text-sm`}
          >
            {t(mode)}
          </button>
        ))}
      </div>
      <p role="status" className="font-body text-sm text-ink-2">
        {liveUnavailable ? t("liveUnavailable") : null}
      </p>
    </div>
  );
}

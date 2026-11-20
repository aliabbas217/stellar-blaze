import { useTranslations } from "next-intl";
import { useId } from "react";
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
 * `liveUnavailable`: the Live option is then disabled and a plain line says why ("Live feeds are not connected in this demo"),
 * so a visitor is never offered a button that does nothing, and a replay is never shown as live. The capability stays: with a
 * deployment that answers `live` the option is a normal button again. Presentational: the state lives in the demo context (`?demo=`).
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
  const noteId = useId();

  return (
    <div className="flex flex-col gap-1">
      <div role="group" aria-label={t("label")} className="inline-flex gap-2">
        {MODES.map((mode) => {
          const unavailable = mode === "live" && liveUnavailable;
          return (
          <button
            key={mode}
            type="button"
            // An unavailable Live is never shown as pressed: the data on screen is the replay.
            aria-pressed={unavailable ? false : value === mode}
            disabled={unavailable}
            {...(unavailable ? { "aria-describedby": noteId } : {})}
            data-island-action={`demo-${mode}`}
            {...(onChange === undefined
              ? {}
              : {
                  onClick: () => {
                    onChange(mode);
                  },
                })}
            className={`${CHIP} min-w-(--target) px-3 font-body text-sm disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-3`}
          >
            {t(mode)}
          </button>
          );
        })}
      </div>
      <p id={noteId} role="status" className="font-body text-sm text-ink-2">
        {liveUnavailable ? t("liveUnavailable") : null}
      </p>
    </div>
  );
}

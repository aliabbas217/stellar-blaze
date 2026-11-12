"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { useProfile, type RevokeOutcome } from "@/features/profile/store";
import { pushCapability, readPushEnv, type PushCapability } from "@/features/push/capability";
import { InstallCard } from "@/features/push/InstallCard";
import { usePush } from "@/features/push/usePush";

/*
 * The Alerts screen's content: what this phone can do about alerts, and the one button that fits. Functional and
 * unstyled on purpose (architect ruling R17: the design phase composes every screen); semantic HTML, every word from
 * messages, targets of 48 px.
 *
 * The browser's abilities are read with useSyncExternalStore, so the server and the first client render agree (null)
 * and the real answer appears right after hydration.
 */

const noopSubscribe = () => () => undefined;

/*
 * A plain <button>, 48 px tall (min-h-12: a gloved hand needs 44), from tokens only. Not the shadcn Button: its class
 * merging (the `cn` package) alone adds about 10 KB gzip to the route, which this screen cannot afford inside the 170 KB
 * worker budget. The design phase decides which button the composed screen uses and what that costs.
 */
const BUTTON_BASE = "min-h-12 rounded-sign px-4 font-body text-base disabled:opacity-50";
const BUTTON_VARIANTS = {
  primary: "bg-action text-on-action",
  secondary: "border-2 border-control bg-surface text-ink",
} as const;

function ActionButton({
  variant = "primary",
  disabled = false,
  onClick,
  ref,
  children,
}: {
  variant?: keyof typeof BUTTON_VARIANTS;
  disabled?: boolean;
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button ref={ref} type="button" disabled={disabled} onClick={onClick} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}`}>
      {children}
    </button>
  );
}

function readCapability(): PushCapability {
  return pushCapability(readPushEnv());
}

function readCanShare(): boolean {
  return "share" in navigator;
}

export interface AlertsSettingsProps {
  /** From the server's runtime environment (VAPID_PUBLIC_KEY); null when the deployment has none. */
  readonly vapidPublicKey: string | null;
  /** The site to subscribe for; null when there is none yet. */
  readonly siteId: string | null;
  /** `?debug=push`: show the browser's subscription JSON with Copy and Share, for the real-phone spike. */
  readonly debug: boolean;
}

export function AlertsSettings(props: AlertsSettingsProps) {
  // What the last removal of the worker's data reported, and a counter that starts the alerts section again after it:
  // the alerts state machine holds the browser's subscription in React state, which a removal made behind its back
  // would leave saying "on". The result lives here, above the key, so that it survives that restart.
  const [removal, setRemoval] = useState<RevokeOutcome | null>(null);
  const [generation, setGeneration] = useState(0);

  return (
    <AlertsPanel
      key={generation}
      {...props}
      removal={removal}
      onRemoved={(outcome) => {
        setRemoval(outcome);
        // Unless alerts may still be on: then the screen keeps its state, and "Turn off alerts" can be tried again.
        if (!outcome.failed.includes("alerts")) setGeneration((current) => current + 1);
      }}
    />
  );
}

function AlertsPanel({
  vapidPublicKey,
  siteId,
  debug,
  removal,
  onRemoved,
}: AlertsSettingsProps & { removal: RevokeOutcome | null; onRemoved: (outcome: RevokeOutcome) => void }) {
  const t = useTranslations("alerts");
  const capability = useSyncExternalStore(noopSubscribe, readCapability, () => null);
  const push = usePush({ vapidPublicKey, siteId });

  return (
    <div className="flex flex-col gap-6">
      <p>{t("intro")}</p>

      {capability === null ? <p>{t("working")}</p> : null}
      {capability === "insecure" ? <Explanation title={t("insecure.title")} body={t("insecure.body")} /> : null}
      {capability === "unsupported" ? <Explanation title={t("unsupported.title")} body={t("unsupported.body")} /> : null}
      {capability === "ios-needs-install" ? <InstallCard /> : null}
      {capability === "supported" ? <Controls push={push} siteId={siteId} /> : null}

      {/* Always visible, whatever the state: the honest limit of alerts on a closed app (ADR 0004). */}
      <p>{t("limitation")}</p>

      {/* Always offered, whatever the phone can do about alerts: the consent copy promises revocation from here. */}
      <RemoveData disabled={push.state === "requesting"} removal={removal} onRemoved={onRemoved} />

      {debug ? <DebugPanel subscription={push.subscription} /> : null}
    </div>
  );
}

type RemoveStep = "idle" | "confirm" | "working";

/**
 * "Remove my data from this phone" (ruling R7: the consent copy promises it from Alerts). A first tap only asks; the
 * second, on "Yes, remove it", calls the store's revoke. Which answer is the safe one gets the focus, and focus goes back
 * to the button afterwards, so a keyboard or screen-reader user is never left on nothing.
 */
function RemoveData({
  disabled,
  removal,
  onRemoved,
}: {
  disabled: boolean;
  removal: RevokeOutcome | null;
  onRemoved: (outcome: RevokeOutcome) => void;
}) {
  const t = useTranslations("alerts.removeData");
  const tAlerts = useTranslations("alerts");
  const revoke = useProfile((state) => state.revoke);
  const [step, setStep] = useState<RemoveStep>("idle");
  const titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // Set when the button has just come back (a "No", or a finished removal), so that the focus follows it.
  const refocus = useRef(removal !== null);

  useEffect(() => {
    if (step === "confirm") {
      keep.current?.focus();
    } else if (step === "idle" && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [step]);

  async function remove() {
    setStep("working");
    let outcome: RevokeOutcome;
    try {
      outcome = await revoke();
    } catch {
      // revoke does not reject; if it ever does, nothing is known to have been removed.
      outcome = { failed: ["storage", "alerts", "cache"] };
    }
    refocus.current = true;
    setStep("idle");
    onRemoved(outcome);
  }

  return (
    <div className="flex flex-col gap-3">
      {step === "confirm" ? (
        <div role="group" aria-labelledby={titleId} className="flex flex-col gap-3">
          <h2 id={titleId} className="font-display text-xl">
            {t("confirmTitle")}
          </h2>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              ref={keep}
              variant="secondary"
              onClick={() => {
                refocus.current = true;
                setStep("idle");
              }}
            >
              {t("cancel")}
            </ActionButton>
            <ActionButton
              onClick={() => {
                void remove();
              }}
            >
              {t("confirm")}
            </ActionButton>
          </div>
        </div>
      ) : (
        <>
          <ActionButton
            ref={trigger}
            variant="secondary"
            disabled={disabled || step === "working"}
            onClick={() => {
              setStep("confirm");
            }}
          >
            {step === "working" ? tAlerts("working") : t("button")}
          </ActionButton>
          <p>{t("hint")}</p>
        </>
      )}
      {/* A live region from the first render, so the result is announced. */}
      <p role="status">{removal === null ? null : removal.failed.length === 0 ? t("done") : t("failed")}</p>
    </div>
  );
}

function Explanation({ title, body }: { title: string; body: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="font-display text-xl">
        {title}
      </h2>
      <p>{body}</p>
    </section>
  );
}

function Controls({ push, siteId }: { push: ReturnType<typeof usePush>; siteId: string | null }) {
  const t = useTranslations("alerts");
  const tStates = useTranslations("states");

  const canDisable = push.state === "subscribed" || (push.state === "error" && push.failure === "disable");

  let status: string;
  if (push.state === "subscribed") status = t("state.subscribed");
  else if (push.state === "requesting") status = t("working");
  else if (push.state === "error") status = push.failure === "disable" ? t("state.disableError") : t("state.error");
  else status = t("state.idle");

  return (
    <div className="flex flex-col gap-3">
      {/* A live region from the first render, so a change of state is announced. */}
      <div role="status" className="flex flex-col gap-2">
        {push.state === "denied" ? (
          <>
            <h2 className="font-display text-xl">{t("denied.title")}</h2>
            <p>{t("denied.body")}</p>
          </>
        ) : (
          <p>{status}</p>
        )}
        {push.problem?.request_id === undefined ? null : <p>{tStates("error.requestId", { id: push.problem.request_id })}</p>}
      </div>

      {siteId === null ? <p>{t("noSite")}</p> : null}

      {push.state === "denied" ? null : push.state === "requesting" ? (
        <ActionButton disabled>{t("working")}</ActionButton>
      ) : canDisable ? (
        <ActionButton
          variant="secondary"
          onClick={() => {
            void push.disable();
          }}
        >
          {t("disable")}
        </ActionButton>
      ) : (
        <ActionButton
          disabled={siteId === null}
          onClick={() => {
            void push.enable();
          }}
        >
          {t("enable")}
        </ActionButton>
      )}
    </div>
  );
}

/**
 * The browser's subscription as JSON, for the real-phone spike (the sender script takes this file). A selectable
 * <textarea> shows it, so where the Clipboard API is missing or refused the worker can still select and copy by hand.
 */
function DebugPanel({ subscription }: { subscription: PushSubscriptionJSON | null }) {
  const t = useTranslations("alerts.debug");
  const headingId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const canShare = useSyncExternalStore(noopSubscribe, readCanShare, () => false);

  if (subscription === null) return null;
  const json = JSON.stringify(subscription, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      // No Clipboard API (an insecure address, an older browser) or it was refused: select the text for a manual copy.
      setCopied(false);
      textarea.current?.select();
    }
  }

  async function share() {
    try {
      await navigator.share({ text: json });
    } catch {
      // The worker closed the share sheet (an AbortError), or the browser cannot share: nothing to report.
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="font-display text-xl">
        {t("heading")}
      </h2>
      {/* JSON is Latin text: it keeps its own direction on an RTL page. */}
      <textarea
        ref={textarea}
        readOnly
        dir="ltr"
        rows={12}
        value={json}
        aria-labelledby={headingId}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        className="w-full rounded-sign border-2 border-control bg-surface p-3 text-sm text-ink"
      />
      <div className="flex flex-wrap gap-3">
        <ActionButton
          variant="secondary"
          onClick={() => {
            void copy();
          }}
        >
          {t("copy")}
        </ActionButton>
        {canShare ? (
          <ActionButton
            variant="secondary"
            onClick={() => {
              void share();
            }}
          >
            {t("share")}
          </ActionButton>
        ) : null}
      </div>
      <p role="status">{copied ? t("copied") : null}</p>
    </section>
  );
}

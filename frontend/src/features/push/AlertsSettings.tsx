"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
  children,
}: {
  variant?: keyof typeof BUTTON_VARIANTS;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}`}>
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

export function AlertsSettings({ vapidPublicKey, siteId, debug }: AlertsSettingsProps) {
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

      {debug ? <DebugPanel subscription={push.subscription} /> : null}
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

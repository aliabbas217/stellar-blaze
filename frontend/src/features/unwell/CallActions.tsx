"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState, useSyncExternalStore, ViewTransition, type ReactNode } from "react";
import { Banner } from "@/components/states/Banner";
import { isDemoMode } from "@/features/demo/constants";
import { useSitePin, type SiteContacts } from "@/features/profile/site-pin";
import "@/styles/view-transitions.css";

/*
 * The three one-tap calls of the unwell sheet: 998 first and large, then the site's supervisor and first-aider (ADR 0045,
 * 0065; CoP 3.1.2(e) is why the supervisor call exists). The sheet sends and logs nothing: the phone call is the notification.
 *
 * Each call is a `tel:` link and nothing else on the real deployment. On the PUBLIC DEMO (`isDemoMode`, the one switch) none
 * of them dials: the number is shown and a confirmation says what a real call would do, because the demo's numbers are
 * synthetic and a demo must never ring an ambulance. The site's numbers come from the phone (the pin; see
 * features/profile/useSiteContactsSync.ts), so the sheet works offline after one visit.
 *
 * Nothing here is ever disabled, in a form, or waiting on the network. A number the site has not given, or the phone has not
 * yet learned, is a designed row that says so and is not a link: a `tel:` with no number would open a dialer on nothing.
 */

const EMERGENCY_NUMBER = "998";

type CallKey = "emergency" | "supervisor" | "firstAider";

const HERO =
  "grid min-h-26 w-full grid-cols-[3rem_1fr] items-center gap-3 rounded-sign bg-signal px-6 py-3 text-start text-on-signal no-underline touch-manipulation";
const SECONDARY =
  "grid min-h-16 w-full grid-cols-[2rem_1fr] items-center gap-3 rounded-sign border-2 border-ink bg-ground px-4 py-2 text-start text-ink no-underline touch-manipulation";

function subscribeToConnection(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser says there is no connection. A lower bound (a Wi-Fi with no internet reads online), which is all this needs. */
function useOffline(): boolean {
  return useSyncExternalStore(
    subscribeToConnection,
    () => !navigator.onLine,
    () => false,
  );
}

/** Says, above the calls, that being offline changes nothing about them. */
export function OfflineNotice() {
  const t = useTranslations("worker.unwell.offline");
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div className="px-4 pt-3">
      <Banner>
        <p>
          <strong className="block font-medium text-ink">{t("title")}</strong>
          {t("body")}
        </p>
      </Banner>
    </div>
  );
}

function PhoneNumber({ value }: { readonly value: string }) {
  return (
    <bdi dir="ltr" className="tabular-nums">
      {value}
    </bdi>
  );
}

/** One call: a link on a real deployment, a button that only confirms on the demo. */
function Call({
  demo,
  number,
  className,
  onDemo,
  children,
}: {
  readonly demo: boolean;
  readonly number: string;
  readonly className: string;
  readonly onDemo: () => void;
  readonly children: ReactNode;
}) {
  if (demo) {
    return (
      <button type="button" onClick={onDemo} className={className}>
        {children}
      </button>
    );
  }
  return (
    <a href={`tel:${number}`} className={className}>
      {children}
    </a>
  );
}

/** A number the sheet cannot offer: the site has none, or this phone has not seen the site's record yet. Information, not a control. */
function DesignedRow({ message, aside }: { readonly message: string; readonly aside?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-sign border-2 border-dashed border-edge px-4 py-3 text-base leading-(--sign-leading-text) text-ink-2">
      <p>{message}</p>
      {aside === undefined ? null : <p className="font-medium text-ink">{aside}</p>}
    </div>
  );
}

/** Why a number is missing: the phone has not learned the site's numbers (`contacts` absent), or the site has none. */
function gapMessage(contacts: SiteContacts | undefined, absent: string, unknown: string): string {
  return contacts === undefined ? unknown : absent;
}

/**
 * `heroIcon` and `rowIcon` are the handset pictogram, drawn by the server component that renders this one and passed in as
 * elements: importing `Pictogram` here would ship the whole pictogram set to the phone for one glyph (the route's script budget).
 */
export function CallActions({ heroIcon, rowIcon }: { readonly heroIcon: ReactNode; readonly rowIcon: ReactNode }) {
  const t = useTranslations("worker.unwell.calls");
  const sheet = useTranslations("worker.unwell");
  const note = sheet("worksOffline");
  const demo = isDemoMode();
  const contacts = useSitePin()?.contacts;
  const offline = useOffline();
  const format = useFormatter();
  const savedAt = contacts?.savedAt;
  const [confirmed, setConfirmed] = useState<CallKey | null>(null);

  const supervisor = contacts?.supervisorPhone ?? null;
  const firstAider = contacts?.firstAiderPhone ?? null;

  /** The line under a call that says what the demo would have done: a persistent live region, so the change is announced. */
  const confirmation = (key: CallKey) => (
    <div role="status">
      {confirmed === key ? (
        <p className="mt-2 rounded-sign border border-edge border-s-3 border-s-ink bg-panel px-4 py-3 text-lg leading-(--sign-leading-text) text-ink">
          <strong className="block font-medium">{t(`demo.${key}`)}</strong>
          {t("demo.noCall")}
        </p>
      ) : null}
    </div>
  );

  const secondary = (key: "supervisor" | "firstAider", number: string) => (
    <Call
      demo={demo}
      number={number}
      className={SECONDARY}
      onDemo={() => {
        setConfirmed(key);
      }}
    >
      {rowIcon}
      <span>
        <b className="block text-xl leading-(--sign-leading-text) font-semibold">{t(`${key}.title`)}</b>
        <span className="block text-base text-ink-2">
          <PhoneNumber value={number} />
          {demo ? <> · {t("demo.synthetic")}</> : null}
        </span>
      </span>
    </Call>
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <ViewTransition name="unwell" share="morph" default="none">
          <Call
            demo={demo}
            number={EMERGENCY_NUMBER}
            className={HERO}
            onDemo={() => {
              setConfirmed("emergency");
            }}
          >
            {heroIcon}
            <span>
              <b className="block text-2xl leading-(--sign-leading-text) font-semibold">{t("emergency.title")}</b>
              <span className="block text-base font-medium">{t("emergency.detail")}</span>
            </span>
          </Call>
        </ViewTransition>
        {confirmation("emergency")}
      </div>

      <div>
        {supervisor === null ? (
          <DesignedRow message={gapMessage(contacts, t("supervisor.absent"), t("supervisor.unknown"))} />
        ) : (
          secondary("supervisor", supervisor)
        )}
        {confirmation("supervisor")}
      </div>

      <div>
        {firstAider === null ? (
          <DesignedRow message={gapMessage(contacts, t("firstAider.absent"), t("firstAider.unknown"))} aside={t("firstAider.askNearby")} />
        ) : (
          secondary("firstAider", firstAider)
        )}
        {confirmation("firstAider")}
      </div>

      <p className="text-base leading-(--sign-leading-text) text-ink-2">{note}</p>
      {/* Offline, a number may be old: say when this phone saved it. Online the sheet is not claiming the numbers are current either, so it stays quiet. */}
      {offline && savedAt !== undefined ? (
        <p className="text-base leading-(--sign-leading-text) text-ink-2">
          {sheet("numbersSavedOn", { date: format.dateTime(new Date(savedAt), { day: "numeric", month: "short", numberingSystem: "latn" }) })}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { components } from "@/api/schema";
import { Pictogram } from "@/components/level/Pictogram";
import { FieldLink } from "@/components/shell/FieldLink";
import { splitDemoName } from "@/components/shell/site-name";
import { ACTION_PRIMARY, ACTION_QUIET } from "@/components/states/actions";
import { joinHref } from "@/features/join/link";
import { chooseDeviceSite } from "@/features/profile/choose-site";
import { useRouter } from "@/i18n/navigation";

/*
 * Step 1 of the join: "Is this your crew?" (redesign S6a, prototypes/worker-join.html). The site and the crew are the API's own records,
 * read from the two public endpoints, so a worker confirms what the API holds, not what the link claims. One tap pins the phone: the site
 * id and the crew id go into the profile store on the device (`chooseDeviceSite`, loaded only now, on the tap), and nothing is sent
 * anywhere. Then Today opens. "No, choose another" goes to the picker (the join page without a code).
 *
 * A pin that could not be written (the store chunk did not load, no signal) or was overtaken by a removal of the phone's data is said, and
 * the same button tries again: a worker is never sent to Today with a pin that is not there.
 */

type Site = components["schemas"]["Site"];
type Crew = components["schemas"]["Crew"];

export function StepCrew({ site, crew }: { readonly site: Site; readonly crew: Crew }) {
  const t = useTranslations("worker.join");
  const shell = useTranslations("shell");
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle");
  const { name, demo } = splitDemoName(site.name, site.synthetic);

  function confirm(): void {
    if (status === "saving") return;
    setStatus("saving");
    chooseDeviceSite(site.id, crew.id).then(
      (written) => {
        if (written) router.replace("/worker");
        else setStatus("failed");
      },
      () => {
        setStatus("failed");
      },
    );
  }

  return (
    <>
      <h1 className="font-display text-3xl leading-(--sign-leading-display) font-semibold text-ink">{t("confirmTitle")}</h1>
      <section data-join-card="" className="flex flex-col gap-4 rounded-card bg-panel p-5">
        <div className="flex flex-col items-start gap-2">
          {demo ? (
            <span className="flex min-h-6 items-center rounded-sign px-2 text-xs leading-none font-semibold tracking-wide text-ink-2 uppercase inset-ring-[1.5px] inset-ring-edge">
              {shell("field.demo")}
            </span>
          ) : null}
          <p className="text-xl leading-(--sign-leading-text) font-semibold break-words text-ink">
            <bdi>{name}</bdi>
          </p>
        </div>
        <div className="flex items-center gap-3 border-t-[1.5px] border-hair pt-4">
          <Pictogram name="buddy" className="size-9 flex-none text-ink" />
          <div className="min-w-0">
            <p className="font-display text-2xl leading-(--sign-leading-text) font-medium break-words text-ink">
              <bdi>{crew.name}</bdi>
            </p>
            <p className="text-base leading-(--sign-leading-text) break-words text-ink-2">
              <bdi>{crew.task_label}</bdi>
            </p>
          </div>
        </div>
      </section>
      <p className="max-w-(--measure) text-base leading-(--sign-leading-text) text-ink-2">{t("note")}</p>
      {status === "failed" ? (
        <p role="alert" className="text-base leading-(--sign-leading-text) text-ink">
          {t("saveFailed")}
        </p>
      ) : null}
      <div className="mt-auto flex flex-col gap-1 pt-4">
        <button type="button" data-primary="" aria-busy={status === "saving" ? "true" : undefined} onClick={confirm} className={`${ACTION_PRIMARY} w-full`}>
          {t("confirm")}
        </button>
        <FieldLink href={joinHref()} replace className={`${ACTION_QUIET} w-full`}>
          {t("other")}
        </FieldLink>
      </div>
    </>
  );
}

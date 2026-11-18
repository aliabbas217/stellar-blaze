"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { FieldLink } from "@/components/shell/FieldLink";
import { Skeleton } from "@/components/states/Skeletons";
import { ACTION_QUIET } from "@/components/states/actions";
import { joinHref } from "@/features/join/link";
import { useRouter } from "@/i18n/navigation";

/**
 * What Today shows on a phone that has no site yet: it hands over to the join page (redesign S6a), which is where a worker finds the site
 * and the crew (a crew's link or code, or the picker) and where "Just looking? Try the demo yard" lives. There is no account and no
 * sign-in. This used to be a dead-end screen with one button; now it is a redirect, `replace` so that Back does not return to a page that
 * only redirects.
 *
 * Until the redirect lands (a frame), and if it cannot, the screen shows a placeholder and one real link to the join page: never a blank
 * and never a dead end.
 */
export function SiteEntry() {
  const router = useRouter();
  const t = useTranslations("worker.join");
  const states = useTranslations("states");

  useEffect(() => {
    router.replace(joinHref());
  }, [router]);

  return (
    <section role="status" aria-busy="true" className="flex flex-col items-start gap-3 px-4 pt-6">
      <Skeleton height="2.5rem" width="14rem" />
      <span className="sr-only">{states("loading")}</span>
      <FieldLink href={joinHref()} replace className={ACTION_QUIET}>
        {t("pageTitle")}
      </FieldLink>
    </section>
  );
}

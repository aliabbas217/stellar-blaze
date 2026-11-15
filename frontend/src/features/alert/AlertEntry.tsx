"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { parseAlertParams } from "@/features/alert/alert-params";
import { AlertSkeleton, AlertView } from "@/features/alert/AlertView";
import { useRouter } from "@/i18n/navigation";

/*
 * The client side of the alert page (F2 W1, I3). The page itself is a STATIC shell (no search params read on the server), so
 * that the service worker can precache it once and answer `/worker/alert?audience=...&level=...` from the cache with no signal:
 * a dynamic page with a query nobody has requested before would land on the offline page on the first tap offline, which is
 * exactly when a heat warning matters. Everything that depended on the query therefore happens here, after hydration:
 *
 *  - the query is read and CHECKED (it is input from outside the app: a tap on a notification, or a link anyone can write);
 *  - a query that is not a warning this app could have sent opens Today instead, by a client-side replace (a card with no
 *    identity would claim a level it cannot name);
 *  - otherwise the card.
 *
 * The skeleton shows meanwhile, and for the moment before the redirect lands: it names no level.
 */
export function AlertEntry() {
  const search = useSearchParams();
  const router = useRouter();
  const text = search.toString();
  const params = useMemo(() => parseAlertParams(new URLSearchParams(text)), [text]);

  useEffect(() => {
    if (params === null) router.replace("/worker");
  }, [params, router]);

  if (params === null) return <AlertSkeleton />;
  return <AlertView params={params} />;
}

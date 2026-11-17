import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { pickMessages } from "./pick-messages";

/*
 * The messages a route group's CLIENT components read, and only those. `NextIntlClientProvider` with no `messages` prop
 * serializes the whole catalogue into the page's flight payload: about 16 KB gzip of the 21 KB document on every route, 6.9 KB
 * of it the judge's namespace, on a phone that never opens the judge (F2 W3.1; measured, see the report). The root layout
 * therefore passes none, and every route group wraps its children here: a field group names its namespaces, a desk group or a
 * page that has not been audited passes nothing and keeps the whole catalogue (unchanged behaviour).
 *
 * Server components read messages through getTranslations and never need this. A client component that reads a namespace not
 * named by its group throws a missing-message error in the browser console: the e2e gate (`gateReport`: console clean) fails on
 * it, and tests/unit/i18n/client-namespaces.test.ts checks every literal namespace of the field features against the lists below.
 */
export async function ClientMessages({ paths, children }: { readonly paths?: readonly string[]; readonly children: ReactNode }) {
  const all = await getMessages();
  return <NextIntlClientProvider messages={paths === undefined ? all : pickMessages(all, paths)}>{children}</NextIntlClientProvider>;
}

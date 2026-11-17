import { FieldShell } from "@/components/shell/FieldShell";
import { WORKER_JOIN_NAMESPACES } from "@/i18n/client-namespaces";
import { ClientMessages } from "@/i18n/ClientMessages";
import { QueryProvider } from "@/providers/QueryProvider";

/*
 * The worker's JOIN group (redesign S6a): the page a crew's link or QR code opens, and the picker for a worker with no code. It has the
 * field shell with the language pill (so a worker can switch language before confirming) and TanStack Query for the two public reads (the
 * site list and a site's crews), and nothing else: no dock (a worker with no crew has no Today, alerts or unwell tab to go to, and the
 * dock's "I feel unwell" is not a join action), no demo context (it would fetch the site list a second time and read `?demo=`), no clock,
 * no site name in the header (none is chosen yet). The URL is `/<locale>/worker/join`; a route group is not a segment.
 *
 * Worker code must not import supervisor or HSE code: see the isolation rule in eslint.config.mjs.
 */
export default function WorkerJoinLayout({ children }: LayoutProps<"/[locale]/worker">) {
  return (
    <ClientMessages paths={WORKER_JOIN_NAMESPACES}>
      <QueryProvider>
        <FieldShell>{children}</FieldShell>
      </QueryProvider>
    </ClientMessages>
  );
}

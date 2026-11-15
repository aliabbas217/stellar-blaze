import { WORKER_APP_NAMESPACES } from "@/i18n/client-namespaces";
import { ClientMessages } from "@/i18n/ClientMessages";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { WorkerFrame } from "./WorkerFrame";

/*
 * The worker shell: TanStack Query and the demo context, then the field shell with the worker dock (WorkerFrame). The
 * query client is mounted here and in the supervisor group only, not at the locale root. Worker code must not import
 * supervisor or HSE code: see the isolation rule in eslint.config.mjs.
 *
 * This group (`(app)`) holds Today, the alert and Alerts. The "I feel unwell" sheet is deliberately NOT here but in `(sheet)`: the
 * demo context below fetches the site list on mount, and the sheet must make no request at all (F2 W1, I4). A route group adds
 * no URL segment, so `/worker/unwell` is unchanged.
 */
export default function WorkerLayout({ children }: LayoutProps<"/[locale]/worker">) {
  return (
    <ClientMessages paths={WORKER_APP_NAMESPACES}>
      <QueryProvider>
        <DemoProvider>
          <WorkerFrame>{children}</WorkerFrame>
        </DemoProvider>
      </QueryProvider>
    </ClientMessages>
  );
}

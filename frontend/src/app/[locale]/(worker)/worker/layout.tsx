import { DemoProvider } from "@/features/demo/DemoProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { WorkerFrame } from "./WorkerFrame";

/*
 * The worker shell: TanStack Query and the demo context, then the field shell with the worker dock (WorkerFrame). The
 * query client is mounted here and in the supervisor group only, not at the locale root. Worker code must not import
 * supervisor or HSE code: see the isolation rule in eslint.config.mjs.
 */
export default function WorkerLayout({ children }: LayoutProps<"/[locale]/worker">) {
  return (
    <QueryProvider>
      <DemoProvider>
        <WorkerFrame>{children}</WorkerFrame>
      </DemoProvider>
    </QueryProvider>
  );
}

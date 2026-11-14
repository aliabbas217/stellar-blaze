import { DemoProvider } from "@/features/demo/DemoProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { SupervisorFrame } from "./SupervisorFrame";

/*
 * The supervisor shell: TanStack Query and the demo context, then the field shell (SupervisorFrame). Supervisor code
 * must not import worker code (on-device personal data stays unreachable from it): see the isolation rule in
 * eslint.config.mjs.
 */
export default function SupervisorLayout({ children }: LayoutProps<"/[locale]/supervisor">) {
  return (
    <QueryProvider>
      <DemoProvider>
        <SupervisorFrame>{children}</SupervisorFrame>
      </DemoProvider>
    </QueryProvider>
  );
}

import { DemoProvider } from "@/features/demo/DemoProvider";
import { ClientMessages } from "@/i18n/ClientMessages";
import { HSE_NAMESPACES } from "@/i18n/client-namespaces";
import { QueryProvider } from "@/providers/QueryProvider";
import { HseFrame } from "./HseFrame";

/*
 * The safety officer's shell: TanStack Query and the demo context (the site and its crews are read the same way the supervisor's are),
 * then the field shell (HseFrame). The client gets only the namespaces the safety view reads (HSE_NAMESPACES). HSE code must not import
 * worker code: see the isolation rule in eslint.config.mjs.
 */
export default function HseLayout({ children }: LayoutProps<"/[locale]/hse">) {
  return (
    <ClientMessages paths={HSE_NAMESPACES}>
      <QueryProvider>
        <DemoProvider>
          <HseFrame>{children}</HseFrame>
        </DemoProvider>
      </QueryProvider>
    </ClientMessages>
  );
}

/*
 * Passes the whole catalogue to client components (`ClientMessages` with no paths: this group has not been audited for its
 * namespaces) and otherwise nothing, on purpose. This layout is the seam for the HSE shell, which is designed together with
 * the HSE screens and lands here, not in the page. HSE code must not import worker code: see the
 * isolation rule in eslint.config.mjs.
 */
import { ClientMessages } from "@/i18n/ClientMessages";

export default function HseLayout({ children }: LayoutProps<"/[locale]/hse">) {
  return <ClientMessages>{children}</ClientMessages>;
}

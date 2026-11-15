import type { ReactNode } from "react";
import { ClientMessages } from "@/i18n/ClientMessages";

/*
 * The dev pages (kit, shell, specimen) render components from every surface, so they keep the whole catalogue (`ClientMessages`
 * with no paths); the root layout passes none (src/i18n/ClientMessages.tsx).
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  return <ClientMessages>{children}</ClientMessages>;
}

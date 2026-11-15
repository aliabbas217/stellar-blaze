import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

/*
 * The link of every field surface (worker and supervisor routes, the dock, the empty and error states): the locale-aware
 * `Link` with prefetch switched off, as one component instead of a `prefetch={false}` that each call site must remember.
 *
 * A prefetch is a request the service worker answers and caches after the page has hydrated, which is just when a worker
 * may be removing their data: Serwist writes the response to `pages-rsc-prefetch`, a cache written after the clearing
 * leaves one behind, and the removal could not honestly say "removed" (F1 invariant b, tests/e2e/revoke.spec.ts). Prefetching
 * a route that does not exist yet also left its request pending, which kept `networkidle` from settling. It costs bytes too:
 * a prefetch on the landing page pulled the whole worker app's JavaScript into a page that is measured on its own.
 *
 * The raw locale `Link` is banned on those surfaces (`no-restricted-imports`, eslint.config.mjs); this file is the one place
 * on them that imports it. `prefetch` is not a prop here: a caller cannot turn it back on.
 */
export type FieldLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

export function FieldLink(props: FieldLinkProps) {
  return <Link {...props} prefetch={false} />;
}

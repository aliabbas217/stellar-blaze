import { SheetFrame } from "./SheetFrame";

/*
 * The worker's SHEET group: the "I feel unwell" call sheet and nothing else. It sits outside the group that mounts TanStack Query
 * and the demo context (`(app)/layout.tsx`), on purpose: that provider fetches the site list on mount, a request that would tell
 * the server (and anyone reading its logs or the Referer) that this phone opened the emergency sheet. The sheet must be silent:
 * nothing is logged or sent, and it works with no signal. The URL is unchanged (`/worker/unwell`); a route group is not a segment.
 */
export default function WorkerSheetLayout({ children }: LayoutProps<"/[locale]/worker">) {
  return <SheetFrame>{children}</SheetFrame>;
}

/*
 * Pass-through on purpose. This layout is the seam for the worker shell (Task 4's bottom bar and the
 * route group's gutter), which is designed together with the worker screens and lands here, not in
 * the pages. Worker code must not import supervisor or HSE code: see the isolation rule in eslint.config.mjs.
 */
export default function WorkerLayout({ children }: LayoutProps<"/[locale]/worker">) {
  return children;
}

/*
 * Pass-through on purpose. This layout is the seam for the supervisor shell (top bar with site name,
 * locale and theme), which is designed together with the supervisor screens and lands here, not in the
 * pages. Supervisor code must not import worker code (on-device personal data stays unreachable from
 * it): see the isolation rule in eslint.config.mjs.
 */
export default function SupervisorLayout({ children }: LayoutProps<"/[locale]/supervisor">) {
  return children;
}

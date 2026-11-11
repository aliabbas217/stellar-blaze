/*
 * Pass-through on purpose. This layout is the seam for the HSE shell, which is designed together with
 * the HSE screens and lands here, not in the page. HSE code must not import worker code: see the
 * isolation rule in eslint.config.mjs.
 */
export default function HseLayout({ children }: LayoutProps<"/[locale]/hse">) {
  return children;
}

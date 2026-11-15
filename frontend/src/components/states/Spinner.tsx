/**
 * The busy mark beside a button's label (the label stays: a loading button keeps its words). The path is Lucide's `loader-circle`
 * (ISC licence; Copyright (c) 2026 Lucide Icons and Contributors, with portions Copyright (c) Cole Bemis as part of Feather, MIT:
 * the notice of node_modules/lucide-react/LICENSE) written out here: importing `lucide-react` for one 90-byte path put its icon factory (about 2 KB gzip) into the
 * first load of every route that showed a spinner, the supervisor screens among them (F2 S1).
 */
export function Spinner({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`animate-spin ${className ?? ""}`}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

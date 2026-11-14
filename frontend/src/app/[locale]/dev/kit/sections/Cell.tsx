import type { ReactNode } from "react";

/**
 * One labelled specimen on the kit page. The caption is an identifier of the design system (a state or a size), not
 * product copy, so it stays in code like the token names on the specimen page. `testId` lets the e2e measure the cell.
 */
export function Cell({
  caption,
  children,
  testId,
  wide = false,
}: {
  readonly caption: string;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Spans the whole row, for a banner or a table. */
  readonly wide?: boolean;
}) {
  return (
    <figure data-testid={testId} className={`flex flex-col gap-2 ${wide ? "col-span-full" : ""}`}>
      <figcaption className="font-mono text-sm text-ink-3">{caption}</figcaption>
      <div className="flex-1 rounded-sign border border-hair bg-ground p-4 text-ink">{children}</div>
    </figure>
  );
}

/** The grid every section lays its cells on: one column on a phone, two and three as the page widens. */
export function CellGrid({ children }: { readonly children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

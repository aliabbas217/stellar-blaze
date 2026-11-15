"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ProofDrawerProps } from "./ProofDrawer";
import type { Proof } from "./proof";

/**
 * The small "Proof" button beside a scored number. It renders nothing without a proof: the caller shows
 * `MissingProvenance` instead of the number (see `Proved`), because a number without provenance is not shown.
 *
 * It is a plain button: the proof stays in React state, never in an attribute (no JSON in the markup), and
 * `data-proof-id` is only a stable handle for tests and for the e2e. The first click loads the drawer with a dynamic
 * import and portals it to <body> (a <dialog> is not valid inside the <p> or <button> a number often sits in); later
 * clicks reopen the same one. When it closes, focus goes back here.
 *
 * `label` replaces the word "Proof" on the button ("Why Orange?"); the accessible name stays "Proof for <what>". `field` is
 * the phone size: 44 px target and 16 px text, for the worker screens (a desk chip is 28 px).
 */
export function ProofChip({
  proof,
  label,
  labelContent,
  field = false,
}: {
  readonly proof: Proof | null;
  readonly label?: string;
  /** The same words as `label`, as nodes (a level name wrapped in <bdi>, so an Urdu name inside an English phrase keeps its place). The accessible name stays `label`. */
  readonly labelContent?: ReactNode;
  readonly field?: boolean;
}) {
  if (proof === null) return null;
  return <Chip proof={proof} label={label} labelContent={labelContent} field={field} />;
}

function Chip({
  proof,
  label,
  labelContent,
  field,
}: {
  readonly proof: Proof;
  readonly label: string | undefined;
  readonly labelContent: ReactNode;
  readonly field: boolean;
}) {
  const t = useTranslations("states.proof");
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [Drawer, setDrawer] = useState<ComponentType<ProofDrawerProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  function openDrawer() {
    setFailed(false);
    setOpen(true);
    if (Drawer !== null) return;
    import("./ProofDrawer").then(
      (module) => {
        setDrawer(() => module.ProofDrawer);
      },
      () => {
        // The chunk did not load (offline with a stale page): say so, never leave a button that does nothing.
        setOpen(false);
        setFailed(true);
      },
    );
  }

  function closed() {
    setOpen(false);
    button.current?.focus();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        data-proof-id={id}
        aria-haspopup="dialog"
        // A custom label is the accessible name as it is written (WCAG 2.5.3: the name contains the visible text).
        aria-label={label ?? t("chipAria", { what: proof.what })}
        onClick={openDrawer}
        className={`inline-flex items-center gap-1 rounded-sign border border-edge bg-transparent text-ink-2 hover:border-ink-2 hover:text-ink ${
          field ? "min-h-(--target) min-w-(--target) touch-manipulation px-3 text-base" : "min-h-7 min-w-7 px-2 text-xs"
        }`}
      >
        <span aria-hidden className="size-1.5 rotate-45 border border-current" />
        {/* One element: the button is a flex row, and a fragment of text, <bdi> and text would be three items with a gap between them. */}
        <span>{labelContent ?? label ?? t("chip")}</span>
      </button>
      {failed ? (
        <span role="status" className="text-xs text-ink-2">
          {t("loadFailed")}
        </span>
      ) : null}
      {Drawer === null ? null : createPortal(<Drawer proof={proof} open={open} onClose={closed} />, document.body)}
    </>
  );
}

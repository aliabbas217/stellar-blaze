"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState, type ComponentType } from "react";
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
 */
export function ProofChip({ proof }: { readonly proof: Proof | null }) {
  if (proof === null) return null;
  return <Chip proof={proof} />;
}

function Chip({ proof }: { readonly proof: Proof }) {
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
        aria-label={t("chipAria", { what: proof.what })}
        onClick={openDrawer}
        className="inline-flex min-h-7 min-w-7 items-center gap-1 rounded-sign border border-edge bg-transparent px-2 text-xs text-ink-2 hover:border-ink-2 hover:text-ink"
      >
        <span aria-hidden className="size-1.5 rotate-45 border border-current" />
        {t("chip")}
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

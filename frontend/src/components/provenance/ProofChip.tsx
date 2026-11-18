"use client";

import { useTranslations } from "next-intl";
import { useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ACTION_PRIMARY_DENSE, ACTION_QUIET } from "@/components/states/actions";
import { CLAIMS_ENGLISH } from "@/i18n/claims-english";
import { useLocaleAttrs } from "@/i18n/use-locale-attrs";
import type { ProofDrawerProps } from "./ProofDrawer";
import type { Proof } from "./proof";

/**
 * The small "Where from" button beside a number. It renders nothing without a proof: the caller shows
 * `MissingProvenance` instead of the number (see `Proved`), because a number without provenance is not shown.
 *
 * It is a plain button: the proof stays in React state, never in an attribute (no JSON in the markup), and
 * `data-proof-id` is only a stable handle for tests and for the e2e. The first click loads the drawer with a dynamic
 * import and portals it to <body> (a <dialog> is not valid inside the <p> or <button> a number often sits in); later
 * clicks reopen the same one. When it closes, focus goes back here.
 *
 * `label` replaces the words "Where from" on the button ("Why Orange?"); the accessible name of the default chip is "Where this number comes from: <what>". `field` is
 * the phone size: 44 px target and 16 px text, for the worker screens (a desk chip is 28 px). `variant="primary"` is the desk
 * primary action (a screen whose one action is "read how this is proved"): the same drawer, the primary button of the state
 * components, and `data-primary` for the design gate. `variant="quiet"` is the text action of a field screen ("Why Orange?" beside the clinical
 * note of Today): the quiet tier of the control system, no ring and no fill.
 */
export function ProofChip({
  proof,
  label,
  labelContent,
  field = false,
  variant = "chip",
}: {
  readonly proof: Proof | null;
  readonly variant?: "chip" | "primary" | "quiet";
  readonly label?: string;
  /** The same words as `label`, as nodes (a level name wrapped in <bdi>, so an Urdu name inside an English phrase keeps its place). The accessible name stays `label`. */
  readonly labelContent?: ReactNode;
  readonly field?: boolean;
}) {
  if (proof === null) return null;
  return <Chip proof={proof} label={label} labelContent={labelContent} field={field} variant={variant} />;
}

function Chip({
  proof,
  label,
  labelContent,
  field,
  variant,
}: {
  readonly variant: "chip" | "primary" | "quiet";
  readonly proof: Proof;
  readonly label: string | undefined;
  readonly labelContent: ReactNode;
  readonly field: boolean;
}) {
  const t = useTranslations("states.proof");
  const pageLanguage = useLocaleAttrs();
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
        // The default chip says "Where from" (states.proof, English by design); a caller's own label ("Why Orange?") is in the page's language.
        {...(label === undefined && labelContent === undefined ? CLAIMS_ENGLISH : pageLanguage)}
        ref={button}
        type="button"
        data-proof-id={id}
        aria-haspopup="dialog"
        // A custom label is the accessible name as it is written (WCAG 2.5.3: the name contains the visible text).
        aria-label={label ?? t("chipAria", { what: proof.what })}
        onClick={openDrawer}
        {...(variant === "primary" ? { "data-primary": "" } : {})}
        className={
          variant === "primary"
            ? `${ACTION_PRIMARY_DENSE} gap-2`
            : variant === "quiet"
              ? ACTION_QUIET
              : `inline-flex items-center gap-1 rounded-pill bg-panel text-ink-2 inset-ring-[1.5px] inset-ring-hair hover:text-ink hover:inset-ring-ink-3 ${
                field ? "min-h-(--target) min-w-(--target) touch-manipulation px-3 text-base" : "min-h-7 min-w-7 px-2 text-xs"
              }`
        }
      >
        {variant === "chip" ? <span aria-hidden className="size-1.5 rotate-45 border border-current" /> : null}
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

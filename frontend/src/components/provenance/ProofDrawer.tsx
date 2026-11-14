"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { ProofRows, RecountButton } from "./ProofRows";
import type { Proof } from "./proof";

export interface ProofDrawerProps {
  readonly proof: Proof;
  readonly open: boolean;
  /** Called whenever the dialog has closed, however it closed (Escape, Close, the backdrop, or `open` going false). */
  readonly onClose: () => void;
}

/**
 * Where a number comes from: protocol line, script, result file, fingerprints, label. A native modal <dialog>: the
 * browser gives it the top layer, the inert page behind it, Escape and focus containment. It is a drawer at the inline end from
 * 48 rem up and a bottom sheet below. The code is a dynamic import (ProofChip loads it on the first click), so a page
 * with fifty chips ships none of it until someone asks.
 *
 * The caller restores focus in `onClose`: browsers do it on close too, but not when the trigger was re-rendered, and not
 * everywhere.
 */
export function ProofDrawer({ proof, open, onClose }: ProofDrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useTranslations("states.proof");

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    // The backdrop click is a pointer convenience on top of the two keyboard paths (Escape, the Close button).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- see above
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="m-0 h-dvh max-h-none w-[min(30rem,100vw)] max-w-none border-0 border-s border-edge bg-panel p-0 text-ink ms-auto backdrop:bg-black open:animate-in open:fade-in-0 open:slide-in-from-end-6 open:duration-(--dur-2) max-md:mt-auto max-md:mb-0 max-md:h-auto max-md:max-h-[85dvh] max-md:w-full max-md:border-s-0 max-md:border-t max-md:open:slide-in-from-bottom-6"
    >
      {open ? (
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-hair bg-panel px-4 py-3">
            <h2 id={titleId} className="font-display text-xl font-medium">
              {t("title")}
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.close()}>
              {t("close")}
            </Button>
          </header>
          <ProofRows proof={proof} />
          <RecountButton proof={proof} />
          <SheetLink claim={proof.claim} />
        </div>
      ) : null}
    </dialog>
  );
}

function SheetLink({ claim }: { readonly claim: string | undefined }) {
  const t = useTranslations("judge.proof");
  if (claim === undefined) return null;
  return (
    <p className="px-4 pb-4">
      <Link href={`/replay/proof/${claim}`} className="text-base text-ink underline underline-offset-4">
        {t("openSheet")}
      </Link>
    </p>
  );
}

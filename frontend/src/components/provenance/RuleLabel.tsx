/*
 * A rule as a person reads it: the plain-language name first, the rule's id after it as a small mono code an auditor can still cite
 * (`Work run too long, or rest too short  P-H7.run`). Presentational: the caller translates the name (the judge's claims copy and the crew
 * screens keep their own catalogues). A rule with no name (an id the app does not know yet) shows the code alone, never an invented name.
 */
export function RuleLabel({ id, name }: { readonly id: string; readonly name: string | null }) {
  return (
    <>
      {name === null ? null : (
        <span data-rule-name="" className="font-medium text-ink">
          {name}
        </span>
      )}
      <code data-rule-id="" dir="ltr" translate="no" className={name === null ? "font-mono text-base text-ink" : "font-mono text-xs text-ink-3"}>
        {id}
      </code>
    </>
  );
}

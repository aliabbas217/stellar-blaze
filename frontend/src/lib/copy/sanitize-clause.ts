/*
 * Clause text for product copy (F2 W5). The API's clause text is the ruleset's own: legal wording quoted verbatim, plus short notes
 * that cite the architecture decision record behind a product rule ("PROTECTIVE READING (ADR 0011 P-H3): ...", "... (ADR 0046)").
 * The ruleset is frozen and hashed, so the text is not changed at the source; the client takes the internal references out where it
 * draws them (copy rule: no ADR jargon in product copy) and touches nothing else.
 *
 * What it removes, and ONLY that:
 *  - an internal reference: "ADR 0011", "ADR 0011 P-H3", "ADR 0011 section 4", "ADR 0046 to 0050", with the parentheses, commas and
 *    spaces it leaves behind: "(ADR 0011 P-H3)" disappears, "(ADR 0011 section 4, not legal text)" becomes "(not legal text)";
 *  - a bare reference that ends a sentence about it ("The one rest day in seven is the reading in ADR 0011 P-H4"): the sentence would
 *    be left meaningless, so that one sentence goes (never a guess at what it said);
 *  - a parenthesised runtime-config key ("below the Red edge (red_twl_w_m2) every crew is stopped": the key names a setting, not a thing a
 *    reader can act on), when it is a snake_case identifier alone in its parentheses;
 *  - a leading internal rule id ("P-H10 No added minutes: ...": the rule id is shown beside the clause on its own).
 *
 * It rewrites one thing: the internal label "PROTECTIVE READING" becomes the plain "Protective reading". The label is how the clause
 * says "this part is a product reading, not the law": dropping it would make a reading look like the law's own words, so the words stay
 * and only their shouting goes.
 *
 * Quoted legal text (everything inside double quotes), article numbers and table references are never touched. If nothing readable is
 * left, the result names the clause's source and article from the text (`sourceId`, "Art. 18") and never a guess; and the result is
 * never empty for a non-empty clause.
 */

const REF_NUMBER = "\\d{4}";
/**
 * A rule id: "P-H3", "P-H1a", "P-H7.cap60", "P-H5.ban_season". A dot belongs to the id only when more id follows it ("P-H7.cap60");
 * a full stop after it ends the sentence and is never part of the id ("... ADR 0011 P-H10. Next" keeps its boundary).
 */
const RULE_ID = "P-H[A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)*";
/** "ADR 0011", "ADR 0011 P-H3", "ADR 0011 section 4", "ADR 0011 sections 4 and 8", "ADR 0046 to 0050". */
const ADR_REF = `ADR\\s+${REF_NUMBER}(?:\\s+to\\s+${REF_NUMBER})?(?:\\s+sections?\\s+\\d+(?:\\s+and\\s+\\d+)?)?(?:\\s+${RULE_ID})?`;
const ADR_REF_G = new RegExp(ADR_REF, "g");
const ADR_REF_ONCE = new RegExp(ADR_REF);

/** The words after which a sentence cannot end: a reference removed from here leaves a sentence with no object. */
const DANGLING = /\b(?:in|of|per|under|see|by|to|as|from|at|the|is|are)\s*$/i;

const LABEL = /PROTECTIVE READINGS?/g;
/** A rule id at the very start, with the separator after it: spaces, or a full stop and spaces ("P-H10. No added minutes"): after a LEADING id the period is the separator, not part of a sentence. */
const LEADING_RULE_ID = /^P-H\d+[A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.?\s+(?=[A-Z])/;
/** A runtime-config key alone in parentheses: snake_case with at least one underscore ("(red_twl_w_m2)"). The law's "(5) five" and "(see Table 1)" never match. */
const CONFIG_KEY = /\s*\([a-z][a-z0-9]*(?:_[a-z0-9]+)+\)/g;
const ARTICLE = /\bArt\.\s*\d+(?:\(\d+\))*(?:\([a-z]\))*/;

/** Separators a removal can leave at the ends of what it was inside of. */
function trimSeparators(text: string): string {
  return text.replace(/^[\s,;:]+/, "").replace(/[\s,;:]+$/, "");
}

/** Parentheses whose text holds an internal reference: take the reference out, keep what else the note says, drop an emptied pair. */
function stripParenthesised(text: string): string {
  return text.replace(/(\s*)\(([^()]*)\)/g, (whole: string, space: string, inner: string) => {
    if (!ADR_REF_ONCE.test(inner)) return whole;
    const rest = trimSeparators(inner.replace(ADR_REF_G, "").replace(/,\s*,/g, ","));
    return rest === "" ? "" : `${space}(${rest})`;
  });
}

/** The index range [start, end) of the sentence of `text` that holds position `at`. A sentence ends at . ! ? (and a closing quote) before a capital. */
function sentenceAround(text: string, at: number): { start: number; end: number } {
  const boundary = /[.!?]["”']?\s+(?=[A-Z"“])/g;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    const edge = match.index + match[0].length;
    if (edge <= at) start = edge;
    else {
      end = match.index + match[0].trimEnd().length;
      break;
    }
  }
  return { start, end };
}

/** A bare reference: it goes alone, unless the words before it cannot stand without it, and then its whole sentence goes. */
function stripBare(text: string): string {
  let out = text;
  for (;;) {
    const match = ADR_REF_ONCE.exec(out);
    if (match === null) return out;
    const sentence = sentenceAround(out, match.index);
    const lead = out.slice(sentence.start, match.index);
    if (lead.trim() !== "" && DANGLING.test(lead)) {
      out = `${out.slice(0, sentence.start)}${out.slice(sentence.end)}`.replace(/\s+$/, "");
      continue;
    }
    const head = out.slice(0, match.index).replace(/\s+$/, "");
    const tail = out.slice(match.index + match[0].length).replace(/^\s+/, "");
    if (head === "") out = tail.replace(/^[:,;]\s*/, "");
    else if (/[,;:]$/.test(head) && /^[,;:]/.test(tail)) out = `${head} ${tail.slice(1).trimStart()}`.trimEnd();
    else out = /^[.,;:!?]/.test(tail) || tail === "" ? `${head}${tail}` : `${head} ${tail}`;
  }
}

/** Words enough to say something: two words of three letters or more ("Art. 18" alone is a pointer, not a sentence). */
function readable(text: string): boolean {
  return (text.match(/\p{L}{3,}/gu) ?? []).length >= 2;
}

export interface SanitizeClauseOptions {
  /** The clause's source id (for example "fdl-33-2021"), shown with the article when nothing readable is left. */
  readonly sourceId?: string | undefined;
}

/** The clause text as product copy: internal ADR and rule-id references out, the law's words and everything else exactly as sent. */
export function sanitizeClause(text: string, options: SanitizeClauseOptions = {}): string {
  if (text.trim() === "") return text;
  let out = stripParenthesised(text);
  out = stripBare(out);
  out = out.replace(CONFIG_KEY, "").replace(LEADING_RULE_ID, "").replace(LABEL, "Protective reading");
  out = out.trim();
  if (out === text.trim() || readable(out)) return out;

  // Nothing readable is left (the clause was all reference): name where it comes from instead, from what the text itself carries.
  const article = ARTICLE.exec(text)?.[0];
  const named = [options.sourceId, article].filter((part): part is string => part !== undefined && part !== "").join(", ");
  if (named !== "") return named;
  const minusTokens = text.replace(ADR_REF_G, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return minusTokens === "" ? text.trim() : minusTokens;
}

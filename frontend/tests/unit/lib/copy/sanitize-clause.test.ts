import { sanitizeClause } from "@/lib/copy/sanitize-clause";

/*
 * The clause text as the real ruleset (ae-heat-2026.1) and the live API send it (F2 W5, Task 24c finding F). The legal wording is
 * quoted verbatim in the clause; the helper must take the internal ADR references out and leave every word of the law, every article
 * and table reference and the source id untouched. The strings below are copied from the ruleset's `[clauses.entries]`.
 */

/** Verbatim legal quotes, exactly as the ruleset prints them. Every one must survive sanitising byte for byte. */
const LAW = {
  art3: '"All work performed directly under the sun and in open places shall not be allowed between the peak hours of 12.30 pm and 3 pm from June 15 to September 15 every year. No business shall be resumed before 3pm, while adhering to what is stipulated in the procedures manual in this regard."',
  art18:
    '"The worker may not work for more than (5) five consecutive hours without a break or breaks of not less than an hour in total, provided that these periods are not included in the working hours."',
  art21: '"The worker shall be granted a paid weekend of not less than one day, according to the employment contract or the work regulation."',
  art5d: '"The juvenile shall not work between 7 pm and 7 am."',
  art17: '"The maximum normal working hours for workers shall be (8) eight hours per day or (48) forty-eight hours per week."',
} as const;

const P_H3 = `Art. 18: ${LAW.art18} PROTECTIVE READING (ADR 0011 P-H3): ban time and ADOSH cycle rest are not credited as the break`;
const P_H4 = `Art. 21: ${LAW.art21} The one rest day in seven is the reading in ADR 0011 P-H4`;
const P_H1A =
  'Art. 11 Prohibition of Work During the Midday: "For technical reasons, the following works are exempt and must continue uninterrupted"; "When technical reasons dictate the continuation of work, employers must provide workers with the following". The attested exempt_reason is a product rule (ADR 0011 P-H1a): an exemption is never inferred';
const P_H5_SEASON =
  'Art. 5(2)(e): "The juvenile shall not be employed in dangerous or arduous works ..." Product reading (ADR 0011 section 4, not legal text): juveniles are excluded from ban-season outdoor heat tasks by default';
const P_H7_CAP =
  'Table 1: Medium Risk, heavy work "Continuous paced work 45 work - 15 rest"; High Risk "Strict Work/Rest cycling required", light work 45 work - 15 rest, heavy work 20 work - 40 rest. Moderate work uses the heavy column (PROTECTIVE READING, ADR 0046)';
const P_H8_HEAVY =
  'CoP 11.0 3.2(b)(i): "with an allowance of 5-7 days for acclimatization before starting hard work in a hot environment"; 7 days is the protective end (ADR 0011 P-H8)';
const P_H10 = "P-H10 No added minutes: a plan never schedules more work minutes per worker than the published shift and never extends it. Product rule, not law (ADR 0011 section 4)";
const P_H7_UNACC =
  'ADR 0011 section 2 step 4: "No unacclimatised worker in Medium/High ticks"; step 6: "Any tick in High zone for a crew that has no acclimatised members is unworkable". Basis: ADOSH Table 1 Medium Risk and High Risk "No unacclimatised person to work"';
const P_H12 =
  "Decision 4: with no usable forecast for an hour the hour is fallback and the planner treats every on-shift tick as High, never less protective than the ban (ADR 0011 P-H12)";

const noJargon = (text: string): void => {
  expect(text).not.toMatch(/ADR\s*\d/);
  expect(text).not.toMatch(/PROTECTIVE READING/);
};

describe("sanitizeClause: internal references out", () => {
  it("removes a parenthesised reference: '(ADR 0011 P-H3)' and keeps the quoted article whole", () => {
    const out = sanitizeClause(P_H3);

    noJargon(out);
    expect(out).toBe(`Art. 18: ${LAW.art18} Protective reading: ban time and ADOSH cycle rest are not credited as the break`);
  });

  it("keeps the 'not law' disclosure: the label PROTECTIVE READING becomes 'Protective reading', it is not deleted", () => {
    expect(sanitizeClause(P_H7_CAP)).toBe(
      'Table 1: Medium Risk, heavy work "Continuous paced work 45 work - 15 rest"; High Risk "Strict Work/Rest cycling required", light work 45 work - 15 rest, heavy work 20 work - 40 rest. Moderate work uses the heavy column (Protective reading)',
    );
  });

  it("takes only the reference out of a parenthesis that says more: '(ADR 0011 section 4, not legal text)' reads '(not legal text)'", () => {
    const out = sanitizeClause(P_H5_SEASON);

    noJargon(out);
    expect(out).toContain("Product reading (not legal text): juveniles are excluded from ban-season outdoor heat tasks by default");
    expect(out.startsWith('Art. 5(2)(e): "The juvenile shall not be employed in dangerous or arduous works ..."')).toBe(true);
  });

  it("removes a trailing reference after a clause note and leaves no stray punctuation or double space", () => {
    expect(sanitizeClause(P_H8_HEAVY)).toBe(
      'CoP 11.0 3.2(b)(i): "with an allowance of 5-7 days for acclimatization before starting hard work in a hot environment"; 7 days is the protective end',
    );
    expect(sanitizeClause(P_H10)).toBe(
      "No added minutes: a plan never schedules more work minutes per worker than the published shift and never extends it. Product rule, not law",
    );
    expect(sanitizeClause(P_H12)).toBe(
      "Decision 4: with no usable forecast for an hour the hour is fallback and the planner treats every on-shift tick as High, never less protective than the ban",
    );
    expect(sanitizeClause(P_H1A)).toContain("is a product rule: an exemption is never inferred");
    noJargon(sanitizeClause(P_H1A));
  });

  it("drops the one sentence a bare reference would leave meaningless, and keeps the law quote before it", () => {
    const out = sanitizeClause(P_H4);

    expect(out).toBe(`Art. 21: ${LAW.art21}`);
    noJargon(out);
  });

  it("removes a bare reference that starts the clause and keeps the rest verbatim", () => {
    const out = sanitizeClause(P_H7_UNACC);

    noJargon(out);
    expect(out).toContain('"No unacclimatised worker in Medium/High ticks"');
    expect(out).toContain('"Any tick in High zone for a crew that has no acclimatised members is unworkable"');
    expect(out).toContain('Basis: ADOSH Table 1 Medium Risk and High Risk "No unacclimatised person to work"');
  });

  it("handles a bare 'ADR 0046' on its own and a range 'ADR 0046 to 0050'", () => {
    expect(sanitizeClause("Moderate work uses the heavy column, ADR 0046, so heavy rates apply")).toBe("Moderate work uses the heavy column, so heavy rates apply");
    expect(sanitizeClause("The warning level is the ADOSH zone, set in ADR 0046 to 0050 as a tunable")).not.toMatch(/ADR/);
  });
});

describe("sanitizeClause: the law is never altered", () => {
  const CLAUSES = { P_H3, P_H4, P_H1A, P_H5_SEASON, P_H7_CAP, P_H8_HEAVY, P_H10, P_H7_UNACC, P_H12 };

  it.each(Object.entries(CLAUSES))("%s: every double-quoted passage, byte for byte, and every article or table reference survive", (_name, clause) => {
    const out = sanitizeClause(clause);
    for (const quote of clause.match(/"[^"]*"/g) ?? []) expect(out, quote).toContain(quote);
    for (const ref of clause.match(/\b(?:Art\.\s*\d+(?:\(\d+\))*(?:\([a-z]\))*|Table \d+|CoP 11\.0 [\d.()a-z]+)/g) ?? []) expect(out, ref).toContain(ref);
    noJargon(out);
  });

  it("test_legal_quote_fixture: a clause with only the law in it comes back identical, character for character", () => {
    for (const text of Object.values(LAW)) expect(sanitizeClause(`Art. 18: ${text}`)).toBe(`Art. 18: ${text}`);
    const noonBan = `Art. 3 Noon Work Ban: ${LAW.art3}`;
    expect(sanitizeClause(noonBan)).toBe(noonBan);
    const hours = `Art. 17(1): ${LAW.art17}; Art. 19(1): "do not exceed two hours per day" and "the total working hours shall not exceed (144) one hundred and forty four hours every (3) three weeks."`;
    expect(sanitizeClause(hours)).toBe(hours);
  });

  it("a number in parentheses that is not a reference is left alone", () => {
    const text = "Art. 17(1): maximum (8) eight hours; (48) forty-eight hours";
    expect(sanitizeClause(text)).toBe(text);
  });

  it("a legal quote with spacing the helper might collapse is not collapsed", () => {
    const text = 'Art. 18: "The  worker   may"  (ADR 0011 P-H3) not';
    expect(sanitizeClause(text)).toContain('"The  worker   may"');
  });
});

describe("sanitizeClause: a clause that is only a reference", () => {
  it("never returns an empty string for a non-empty clause", () => {
    for (const text of ["ADR 0011", "(ADR 0011 P-H3)", "PROTECTIVE READING (ADR 0011 P-H3)", "  ADR 0046 "]) {
      expect(sanitizeClause(text).trim(), text).not.toBe("");
    }
  });

  it("names the source id and the article from the text itself, never a guess", () => {
    expect(sanitizeClause("(ADR 0011 P-H3) Art. 18 (ADR 0011)", { sourceId: "fdl-33-2021" })).toBe("fdl-33-2021, Art. 18");
    expect(sanitizeClause("(ADR 0011)", { sourceId: "fdl-33-2021" })).toBe("fdl-33-2021");
    expect(sanitizeClause("(ADR 0011 P-H3) Art. 18 ADR 0011")).toBe("Art. 18");
  });

  it("falls back to the original text when there is no source, no article and nothing else", () => {
    expect(sanitizeClause("ADR 0011")).toBe("ADR 0011");
  });

  it("leaves an empty clause empty", () => {
    expect(sanitizeClause("")).toBe("");
  });
});

describe("sanitizeClause: a rule id never swallows the sentence's own full stop (W6.5)", () => {
  it("keeps the boundary after a reference that ends a sentence: 'ADR 0011 P-H10. Next' stays two sentences", () => {
    const out = sanitizeClause("This follows the reading ADR 0011 P-H10. Next sentence stays as it was.");

    noJargon(out);
    expect(out).toBe("This follows the reading. Next sentence stays as it was.");
  });

  it("keeps the boundary after a reference with no rule id, and after a reference inside the last sentence", () => {
    expect(sanitizeClause("This follows the reading ADR 0011. Next sentence stays.")).toBe("This follows the reading. Next sentence stays.");
    expect(sanitizeClause("Next sentence stays. It follows the reading ADR 0011 P-H4.")).toBe("Next sentence stays. It follows the reading.");
  });

  it("still takes a dotted rule id whole: P-H7.cap60 and P-H5.ban_season are one token, the full stop after it is not part of it", () => {
    expect(sanitizeClause("Rest is capped, the reading in ADR 0011 P-H7.cap60. Next sentence stays.")).toBe("Next sentence stays.");
    expect(sanitizeClause("Juveniles are excluded (ADR 0011 P-H5.ban_season). Next sentence stays.")).toBe("Juveniles are excluded. Next sentence stays.");
    expect(sanitizeClause("It is a product rule ADR 0011 P-H5.ban_season, not law.")).toBe("It is a product rule, not law.");
  });

  it("a leading rule id followed by a space is stripped, and the clause after it is untouched", () => {
    expect(sanitizeClause("P-H10 No added minutes: a plan never extends the shift.")).toBe("No added minutes: a plan never extends the shift.");
  });

  it("a LEADING rule id followed by a full stop and a space is stripped with its period (the period is the separator), so no internal id shows", () => {
    const out = sanitizeClause("P-H10. No added minutes.");

    expect(out).toBe("No added minutes.");
    noJargon(out);
    expect(out).not.toMatch(/P-H\d/);
  });

  it("a dot INSIDE a leading id stays part of the id, and a sentence-final period elsewhere stays", () => {
    expect(sanitizeClause("P-H2.daily Rest is counted per shift. Next sentence.")).toBe("Rest is counted per shift. Next sentence.");
    expect(sanitizeClause("P-H10. No added minutes. A plan never extends the shift.")).toBe("No added minutes. A plan never extends the shift.");
  });
});

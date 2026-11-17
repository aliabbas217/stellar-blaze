import { classify, declaredKind, disagreement, thresholdFor } from "../../e2e/helpers/contrast-class";

/*
 * Fix round 3, important 1: what threshold a line of text is held to comes from its RENDERED size and weight (WCAG 2.2, "large
 * text": at least 24 CSS px, or at least 18.66 px (14 pt) and bold), not from an attribute that says "large". The attribute is only
 * what the page declares, and a mismatch with the rendered size is itself a failure.
 */

describe("classify: WCAG large text by rendered size and weight", () => {
  it("test_classifier_boundaries: 24 px is large at any weight, 23.99 px is not", () => {
    expect(classify(24, 400)).toBe("large");
    expect(classify(23.99, 400)).toBe("body");
    expect(classify(36, 400)).toBe("large");
    expect(classify(48, 300)).toBe("large");
  });

  it("18.66 px is large only when bold: weight 700 and up, not 600", () => {
    expect(classify(18.66, 700)).toBe("large");
    expect(classify(18.65, 700)).toBe("body");
    expect(classify(18.66, 600)).toBe("body");
    expect(classify(18.66, 400)).toBe("body");
    expect(classify(20, 700)).toBe("large");
    expect(classify(20, 500)).toBe("body");
    expect(classify(23.99, 700)).toBe("large"); // bold and over 18.66
  });

  it("small text and unparsable sizes are body (the stricter class)", () => {
    expect(classify(12, 400)).toBe("body");
    expect(classify(16, 700)).toBe("body");
    expect(classify(Number.NaN, 400)).toBe("body");
  });

  it("thresholds: 4.5 for body, 3 for large", () => {
    expect(thresholdFor("body")).toBe(4.5);
    expect(thresholdFor("large")).toBe(3);
  });
});

describe("declaredKind and disagreement", () => {
  it("a station name ('label') is body text for the threshold", () => {
    expect(declaredKind("label")).toBe("body");
    expect(declaredKind("body")).toBe("body");
    expect(declaredKind("large")).toBe("large");
  });

  it("test_declared_kind_must_match_rendered_size: an h1 declared large but rendered at 20 px is reported by name", () => {
    expect(disagreement({ name: "h1", declared: "large", fontSizePx: 20, fontWeight: 400 })).toMatch(/h1.*declared large.*20px.*body/);
    expect(disagreement({ name: "h1", declared: "large", fontSizePx: 36, fontWeight: 400 })).toBeNull();
    expect(disagreement({ name: "lede", declared: "body", fontSizePx: 18, fontWeight: 400 })).toBeNull();
    // the other way round too: a body line that grew to 24 px is declared wrong (held to the stricter 4.5 meanwhile)
    expect(disagreement({ name: "kicker", declared: "body", fontSizePx: 24, fontWeight: 400 })).toMatch(/kicker.*declared body.*large/);
    expect(disagreement({ name: "station", declared: "label", fontSizePx: 14, fontWeight: 500 })).toBeNull();
  });
});

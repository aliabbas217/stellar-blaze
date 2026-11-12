import AxeBuilder from "@axe-core/playwright";
import { test, type Page } from "@playwright/test";

/**
 * The axe rules of WCAG 2.2 level A and AA. axe tags a rule with the version of WCAG that introduced its criterion and
 * the level, so the set is the five tags below: `wcag21a` is one rule (label in name, 2.5.3), and a run without it would
 * skip a level A criterion without saying so. tests/e2e/a11y.spec.ts pins that every tag finds something.
 */
export const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface AxeFinding {
  /** The axe rule, for example "color-contrast". */
  readonly rule: string;
  readonly impact: string | null | undefined;
  readonly help: string;
  readonly helpUrl: string;
  /** A selector for each element that breaks the rule. */
  readonly targets: string[];
}

/**
 * Runs axe on what the page shows now and returns its violations (an empty list when the page passes). Wait for the
 * page's own content before calling it: axe judges the DOM it finds, a loading state included.
 * The full axe result is attached to the test when there is a violation, for the HTML report.
 */
export async function axeViolations(page: Page): Promise<AxeFinding[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA_TAGS).analyze();
  if (violations.length > 0) {
    await test.info().attach("axe-violations.json", {
      body: JSON.stringify(violations, null, 2),
      contentType: "application/json",
    });
  }
  return violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    targets: violation.nodes.map((node) => JSON.stringify(node.target)),
  }));
}

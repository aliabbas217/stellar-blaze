import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * F2 Task 22: a claims block (lang="en" dir="ltr", src/i18n/claims-english.tsx) inside an Urdu page would inherit the page's
 * line height (2.5) and its Nastaliq stack, because both properties inherit. globals.css resets them for every nested lang="en".
 * This pins that rule, and that the two Arabic-script leadings that make it necessary are still what they were.
 */

const css = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");
const tokens = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");

describe("English blocks inside a right-to-left page", () => {
  it("a nested lang=en element takes the English face and the body leading", () => {
    const rule = /\[lang="en"\]:not\(:root\)\s*\{([^}]*)\}/.exec(css);
    expect(rule, "the rule exists").not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/--font-body:\s*var\(--font-display\)/);
    expect(body).toMatch(/font-family:\s*var\(--font-display/);
    expect(body).toMatch(/line-height:\s*var\(--leading-body\)/);
  });

  it("the rule is needed: Urdu and Arabic set their leading on the language, and it is not 1.5", () => {
    expect(tokens).toMatch(/--leading-ur:\s*2\.5/);
    expect(tokens).toMatch(/--leading-ar:\s*1\.8/);
    expect(tokens).toMatch(/--leading-body:\s*1\.5/);
  });
});

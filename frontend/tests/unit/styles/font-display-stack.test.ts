import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Which face draws the Arabic script of a display heading (F2 Task 22 fix round 1 found it, architect option (c), 2026-11-16).
 *
 * next/font gives Archivo `--font-display: Archivo, "Archivo Fallback"`, and "Archivo Fallback" is `@font-face { src: local(Arial) }` with no
 * unicode-range, so a stack that starts with that variable lets Arial (an operating-system font, absent on Android and most Linux) draw
 * the Urdu and Arabic letters before the body family is ever tried. In ur and ar the first family of the display stack is therefore the
 * Archivo web face alone (it has no Arabic glyphs, so the Arabic script falls through to the locale body family, and Latin letters and
 * digits keep Archivo); every other locale keeps the next/font stack. The browser-level proof, on the production build, is the strict face
 * test in tests/e2e/landing-display-face.spec.ts; this pins the CSS that produces it, so a refactor cannot quietly bring Arial back.
 */

const root = path.resolve(import.meta.dirname, "../../..");
const globals = readFileSync(path.join(root, "src/styles/globals.css"), "utf8");
const fonts = readFileSync(path.join(root, "src/app/fonts.ts"), "utf8");

/** The declaration block of the first rule whose selector (comments removed) satisfies `match`. */
function ruleBody(match: (selector: string) => boolean): string | undefined {
  const code = globals.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match((rule[1] ?? "").replace(/\s+/g, " ").trim())) return rule[2] ?? "";
  }
  return undefined;
}

const displayUtility = ruleBody((selector) => selector === "@utility font-display") ?? "";
/** Every declaration block whose selector list names `:lang(code)` and that sets `--font-display-latin`. */
function latinDeclarations(code: string): string[] {
  const css = globals.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? "").split(",").map((part) => part.trim());
    const body = rule[2] ?? "";
    if (selectors.includes(`:lang(${code})`) && body.includes("--font-display-latin")) found.push(/--font-display-latin:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? "");
  }
  return found;
}

describe("the display font stack", () => {
  it("starts with the Latin display token, not with next/font's variable (whose fallback face claims every code point)", () => {
    const stack = /font-family:\s*([^;]+);/.exec(displayUtility)?.[1] ?? "";
    expect(stack.replace(/\s+/g, " ").trim().startsWith("var(--font-display-latin,")).toBe(true);
    // The body family still follows, so the Arabic script, Devanagari and Bengali reach their own family.
    expect(stack).toContain("var(--font-body,");
  });

  it("is Archivo alone in Urdu and Arabic, so no operating-system face is tried before the locale family", () => {
    for (const code of ["ur", "ar"]) {
      const declared = latinDeclarations(code);
      expect(declared, code).toHaveLength(1);
      expect(declared[0], code).toBe("Archivo");
    }
  });

  it("is untouched for English, Hindi, Bengali and Nepali (their display faces do not change)", () => {
    for (const code of ["en", "hi", "bn", "ne"]) expect(latinDeclarations(code), code).toEqual([]);
  });

  it("an English claims block inside an Urdu or Arabic page takes the English stack back", () => {
    const body = ruleBody((selector) => selector === '[lang="en"]:not(:root)') ?? "";
    expect(body).toMatch(/--font-display-latin:\s*var\(--font-display\)/);
  });

  it("names a family that next/font really generates for Archivo", () => {
    // next/font names the family after the Google font: `Archivo({...})` yields `font-family: 'Archivo'` and `Archivo Fallback`.
    expect(fonts).toMatch(/const display = Archivo\(\{/);
    expect(fonts).not.toMatch(/adjustFontFallback:\s*false/);
  });
});

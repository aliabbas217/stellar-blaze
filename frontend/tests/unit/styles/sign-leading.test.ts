import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * The level sign and its skeleton read two custom properties for their line heights (components/level/LevelSign.tsx).
 * globals.css declares them once per language. This pins that every routed language has both, with the leading the
 * language's script needs, so the skeleton's height cannot drift from the sign's in any language.
 */

const styles = path.resolve(import.meta.dirname, "../../../src/styles");
const globals = readFileSync(path.join(styles, "globals.css"), "utf8");
const tokens = readFileSync(path.join(styles, "tokens.css"), "utf8");

/** The declarations of the first rule whose selector list contains `:lang(code)` and that sets the sign's leading. */
function signLeading(code: string): { text: string; word: string; display: string } {
  for (const rule of globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1] ?? "";
    const body = rule[2] ?? "";
    if (!selector.includes(`:lang(${code})`) || !body.includes("--sign-leading-text")) continue;
    const text = /--sign-leading-text:\s*var\((--[a-z-]+)\)/.exec(body)?.[1];
    const word = /--sign-leading-word:\s*var\((--[a-z-]+)\)/.exec(body)?.[1];
    const display = /--sign-leading-display:\s*var\((--[a-z-]+)\)/.exec(body)?.[1];
    if (text !== undefined && word !== undefined && display !== undefined) return { text, word, display };
  }
  throw new Error(`globals.css declares no sign leading for :lang(${code})`);
}

describe("the sign's language-aware leading", () => {
  it.each(["en", "ar", "ur", "hi", "bn", "ne"])("%s declares the three properties, from tokens that exist", (code) => {
    const { text, word, display } = signLeading(code);
    expect(tokens, text).toContain(`${text}:`);
    expect(tokens, word).toContain(`${word}:`);
    expect(tokens, display).toContain(`${display}:`);
  });

  it("sets the level word solid in English only; every other script gets its own tall leading", () => {
    expect(signLeading("en")).toMatchObject({ text: "--leading-body", word: "--leading-solid" });
    expect(signLeading("ar")).toMatchObject({ text: "--leading-ar", word: "--leading-ar" });
    expect(signLeading("ur")).toMatchObject({ text: "--leading-ur", word: "--leading-ur" });
    for (const code of ["hi", "bn", "ne"]) {
      expect(signLeading(code), code).toMatchObject({ text: "--leading-body", word: "--leading-body" });
    }
  });

  // F2 Task 22, the display-size leading for Arabic script (a design decision the report puts to the controller, with the numbers).
  // The 2.5 rule is for body text and the 64 px level word; at 36 to 48 px display sizes it is far more than the glyph needs.
  it("display type (the landing's headings) has its own leading token: English solid, Arabic script tighter than its body rule, Indic as body", () => {
    expect(signLeading("en").display).toBe("--leading-solid");
    expect(signLeading("ar").display).toBe("--leading-ar-display");
    expect(signLeading("ur").display).toBe("--leading-ur-display");
    for (const code of ["hi", "bn", "ne"]) expect(signLeading(code).display, code).toBe("--leading-body");
    const token = (name: string) => Number.parseFloat(new RegExp(`${name}:\\s*([0-9.]+)`).exec(tokens)?.[1] ?? "NaN");
    expect(token("--leading-ur-display")).toBeLessThan(token("--leading-ur"));
    expect(token("--leading-ar-display")).toBeLessThan(token("--leading-ar"));
    // never below the line the glyphs need (Latin body is 1.5; a display line shorter than that would clip marks)
    expect(token("--leading-ar-display")).toBeGreaterThanOrEqual(1.2);
    expect(token("--leading-ur-display")).toBeGreaterThanOrEqual(1.2);
    // The body rule is untouched.
    expect(token("--leading-ur")).toBe(2.5);
    expect(token("--leading-ar")).toBe(1.8);
  });

  it("the landing's h1 and the chapter headings read it (the hero's own h1, and one shared heading class for the chapters), and no other file moved to it", () => {
    const dir = path.resolve(import.meta.dirname, "../../../src/features/judge/landing");
    const landing = readFileSync(path.join(dir, "LandingView.tsx"), "utf8");
    const chapters = readFileSync(path.join(dir, "LandingChapters.tsx"), "utf8");
    expect(landing.match(/leading-\(--sign-leading-display\)/g)?.length).toBe(1);
    expect(chapters.match(/leading-\(--sign-leading-display\)/g)?.length).toBe(1);
    // every chapter heading takes that one class, not a leading of its own
    expect(chapters.match(/className=\{HEADING\}/g)?.length).toBe(4);
    expect(landing + chapters).not.toContain("leading-(--sign-leading-word)");
  });

  it("matches the line height the page itself uses for the language", () => {
    // :lang(ar) and :lang(ur) already set the body line height in globals.css: the sign must not disagree with it.
    expect(globals).toMatch(/:lang\(ar\)\s*\{\s*line-height:\s*var\(--leading-ar\)/);
    expect(globals).toMatch(/:lang\(ur\)\s*\{\s*line-height:\s*var\(--leading-ur\)/);
  });
});

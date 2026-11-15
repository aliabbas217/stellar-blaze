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
function signLeading(code: string): { text: string; word: string } {
  for (const rule of globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1] ?? "";
    const body = rule[2] ?? "";
    if (!selector.includes(`:lang(${code})`) || !body.includes("--sign-leading-text")) continue;
    const text = /--sign-leading-text:\s*var\((--[a-z-]+)\)/.exec(body)?.[1];
    const word = /--sign-leading-word:\s*var\((--[a-z-]+)\)/.exec(body)?.[1];
    if (text !== undefined && word !== undefined) return { text, word };
  }
  throw new Error(`globals.css declares no sign leading for :lang(${code})`);
}

describe("the sign's language-aware leading", () => {
  it.each(["en", "ar", "ur", "hi", "bn", "ne"])("%s declares both properties, from tokens that exist", (code) => {
    const { text, word } = signLeading(code);
    expect(tokens, text).toContain(`${text}:`);
    expect(tokens, word).toContain(`${word}:`);
  });

  it("sets the level word solid in English only; every other script gets its own tall leading", () => {
    expect(signLeading("en")).toEqual({ text: "--leading-body", word: "--leading-solid" });
    expect(signLeading("ar")).toEqual({ text: "--leading-ar", word: "--leading-ar" });
    expect(signLeading("ur")).toEqual({ text: "--leading-ur", word: "--leading-ur" });
    for (const code of ["hi", "bn", "ne"]) {
      expect(signLeading(code), code).toEqual({ text: "--leading-body", word: "--leading-body" });
    }
  });

  it("matches the line height the page itself uses for the language", () => {
    // :lang(ar) and :lang(ur) already set the body line height in globals.css: the sign must not disagree with it.
    expect(globals).toMatch(/:lang\(ar\)\s*\{\s*line-height:\s*var\(--leading-ar\)/);
    expect(globals).toMatch(/:lang\(ur\)\s*\{\s*line-height:\s*var\(--leading-ur\)/);
  });
});

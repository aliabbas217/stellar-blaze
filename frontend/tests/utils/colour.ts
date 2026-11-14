import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Reads src/styles/tokens.css for tests: a tiny parser (top-level rules and custom properties only) and the
 * OKLCH to 8-bit sRGB hex conversion a browser performs when it renders a token. Shared by the tests that must
 * agree with the tokens (tests/unit/styles/tokens.test.ts, tests/unit/app/manifest.test.ts), so there is one
 * parser and one colour conversion to keep right. scripts/contrast.mjs carries its own, independent copy of both
 * on purpose: tokens.test.ts runs it and compares, so a mistake in either shows up as a disagreement.
 */

const frontendRoot = path.resolve(import.meta.dirname, "../..");

interface Rule {
  readonly selector: string;
  readonly body: string;
}

export function rulesOf(css: string): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let depth = 0;
  let selectorStart = 0;
  let bodyStart = 0;
  let selector = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) {
        selector = source.slice(selectorStart, i).trim().replace(/\s+/g, " ");
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        rules.push({ selector, body: source.slice(bodyStart, i) });
        selectorStart = i + 1;
      }
    }
  }
  return rules;
}

function declarationsOf(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(?:--([\w-]+)|\b(color-scheme))\s*:\s*([^;]+);/g)) {
    const name = m[1] ?? m[2];
    const value = m[3];
    if (name !== undefined && value !== undefined) out[name] = value.trim().replace(/\s+/g, " ");
  }
  return out;
}

/** Merged custom properties of every top-level rule with exactly this selector. */
export function tokensFor(rules: readonly Rule[], selector: string): Record<string, string> {
  const matching = rules.filter((r) => r.selector === selector);
  if (matching.length === 0) throw new Error(`tokens.css has no rule "${selector}"`);
  return Object.fromEntries(matching.flatMap((r) => Object.entries(declarationsOf(r.body))));
}

/**
 * OKLCH to 8-bit sRGB hex, clamped to the gamut. An alpha part (`/ 0.72`) is accepted and ignored: the hex is the
 * colour a browser composites over whatever is behind it.
 */
export function oklchToHex(value: string): string {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/.exec(value);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`not an oklch() value: ${value}`);
  }
  const L = Number(m[1]);
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const byte = (c: number) => {
    const clamped = Math.min(1, Math.max(0, c));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(byte).join("")}`;
}

/** The night semantic rule: `:root` plus a nested `data-theme="night"` subtree on a page that is in sun mode. */
export const NIGHT_SELECTOR = ':root, [data-theme="night"]';
export const SUN_SELECTOR = '[data-theme="sun"]';

/** The custom-property sets of tokens.css that the tests read. Parsed once, on first use. */
export function loadTokens() {
  const css = readFileSync(path.join(frontendRoot, "src/styles/tokens.css"), "utf8");
  const topLevel = rulesOf(css);
  const rootTokens = tokensFor(topLevel, ":root");
  const nightRule = tokensFor(topLevel, NIGHT_SELECTOR);
  const sunRule = tokensFor(topLevel, SUN_SELECTOR);
  const primitives = Object.fromEntries(Object.entries(rootTokens).filter(([name]) => name.startsWith("ref-")));
  const semanticNight = Object.fromEntries(Object.entries(nightRule).filter(([name]) => name !== "color-scheme"));
  const sunOverrides = Object.fromEntries(Object.entries(sunRule).filter(([name]) => name !== "color-scheme"));
  const semanticSun = { ...semanticNight, ...sunOverrides };
  return { css, topLevel, rootTokens, nightRule, sunRule, primitives, semanticNight, sunOverrides, semanticSun };
}

/** Resolves every `var(--ref-*)` of a semantic theme to the sRGB hex of its primitive. */
export function resolveTheme(
  theme: Readonly<Record<string, string>>,
  primitives: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(theme)) {
    const ref = /^var\(--(ref-[\w-]+)\)$/.exec(value)?.[1];
    const primitive = ref === undefined ? undefined : primitives[ref];
    if (primitive === undefined) throw new Error(`--${name}: ${value} does not resolve to a primitive`);
    out[name] = oklchToHex(primitive);
  }
  return out;
}

/** Every semantic colour of both themes as the sRGB hex a browser renders, by token name without the `--`. */
export function themeHex(): { readonly night: Record<string, string>; readonly sun: Record<string, string> } {
  const { semanticNight, semanticSun, primitives } = loadTokens();
  return { night: resolveTheme(semanticNight, primitives), sun: resolveTheme(semanticSun, primitives) };
}

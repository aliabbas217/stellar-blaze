import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Reads src/styles/tokens.css for tests: a tiny parser (top-level rules and custom properties only) and the
 * OKLCH to 8-bit sRGB hex conversion a browser performs when it renders a token. Shared by the tests that must
 * agree with the tokens (tests/unit/styles/tokens.test.ts, tests/unit/app/manifest.test.ts), so there is one
 * parser and one colour conversion to keep right.
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
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2];
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

/** OKLCH to 8-bit sRGB hex, clamped to the gamut. */
export function oklchToHex(value: string): string {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
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

/** The custom-property sets of tokens.css that the tests read. Parsed once, on first use. */
export function loadTokens() {
  const css = readFileSync(path.join(frontendRoot, "src/styles/tokens.css"), "utf8");
  const topLevel = rulesOf(css);
  const rootTokens = tokensFor(topLevel, ":root");
  const lightRule = tokensFor(topLevel, ':root, [data-theme="light"]');
  const darkOverride = tokensFor(topLevel, '[data-theme="dark"]');
  const darkMedia = rulesOf(topLevel.find((r) => r.selector === "@media (prefers-color-scheme: dark)")?.body ?? "");
  const darkSystem = tokensFor(darkMedia, ':root:not([data-theme="light"])');
  const primitives = Object.fromEntries(Object.entries(rootTokens).filter(([name]) => name.startsWith("ref-")));
  const semanticLight = Object.fromEntries(Object.entries(lightRule).filter(([name]) => name !== "color-scheme"));
  const semanticDark = { ...semanticLight, ...darkOverride };
  return { topLevel, rootTokens, lightRule, darkOverride, darkSystem, primitives, semanticLight, semanticDark };
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
export function themeHex(): { readonly light: Record<string, string>; readonly dark: Record<string, string> } {
  const { semanticLight, semanticDark, primitives } = loadTokens();
  return { light: resolveTheme(semanticLight, primitives), dark: resolveTheme(semanticDark, primitives) };
}

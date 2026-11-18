// Prints the contrast table of DESIGN.md section 3 from src/styles/tokens.css (WCAG 2.2 relative luminance of the
// 8-bit sRGB a browser renders for each oklch() value).
//
// Port of docs/design/critique/contrast.mjs, which had its palette hard-coded; this one reads the real tokens so the
// table cannot drift from the CSS. It is deliberately independent of tests/utils/colour.ts (own parser, own
// conversion): tests/unit/styles/tokens.test.ts runs it with --json and compares, so a mistake in either shows up as a
// disagreement instead of two copies of the same error.
//
// Usage: node scripts/contrast.mjs          the markdown table (commit the output to docs/design/f2/gate/tokens/contrast.txt)
//        node scripts/contrast.mjs --json   { night|sun: { token: { ground|panel: ratio } }, states: { night|sun: { state: ratio } } }
// Exit code 1 if a pair is below its floor (4.5 text, 3 graphics).
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Every innermost `selector { declarations }` block, in source order.
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, " "),
  decls: Object.fromEntries([...m[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()])),
}));
const declsFor = (...selectors) =>
  Object.assign({}, ...blocks.filter((b) => selectors.includes(b.selector)).map((b) => b.decls));

const primitives = declsFor(":root");
const night = declsFor(':root, [data-theme="night"]');
const sun = { ...night, ...declsFor('[data-theme="sun"]') };

function oklchToRgb(value) {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!m) throw new Error(`not an oklch() value: ${value}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const lms = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3);
  const [l, mm, s] = lms;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return linear.map((c) => {
    const x = Math.min(1, Math.max(0, c));
    return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
  });
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
  return (hi + 0.05) / (lo + 0.05);
}

/** The rgb a semantic token renders as in a theme: semantic -> var(--ref-*) -> oklch(). */
function rgbOf(theme, name) {
  const ref = /^var\(--([\w-]+)\)$/.exec(theme[name] ?? "")?.[1];
  const value = ref === undefined ? undefined : primitives[ref];
  if (value === undefined) throw new Error(`--${name} does not resolve to a primitive`);
  return oklchToRgb(value);
}

const themes = { night, sun };
const GROUNDS = ["ground", "panel"];
const TEXT = ["ink", "ink-2", "ink-3", "signal"];
const GRAPHIC = ["edge", "focus", "lv-green", "lv-amber", "lv-orange", "lv-red"];

// ---------- control states: the fills of hover, pressed and busy ----------
// `color-mix(in oklch, A, B p%)`: a linear mix of the oklch components, hue along the shorter arc (CSS Color 4). Both fills of every
// control state must still meet 4.5:1 against the control's text, so the mixes are computed here from the --mix-* tokens.
const oklchOf = (value) => {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!m) throw new Error(`not an oklch() value: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const primitiveOf = (theme, name) => {
  const ref = /^var\(--([\w-]+)\)$/.exec(theme[name] ?? "")?.[1];
  const value = ref === undefined ? undefined : primitives[ref];
  if (value === undefined) throw new Error(`--${name} does not resolve to a primitive`);
  return value;
};
function mixRgb(theme, base, other, percentToken) {
  const p = Number(/^([\d.]+)%$/.exec(primitives[percentToken] ?? "")?.[1]) / 100;
  if (Number.isNaN(p)) throw new Error(`--${percentToken} is not a percentage`);
  const [L1, C1, h1] = oklchOf(primitiveOf(theme, base));
  const [L2, C2, h2] = oklchOf(primitiveOf(theme, other));
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const h = (h1 + dh * p + 360) % 360;
  return oklchToRgb(`oklch(${L1 + (L2 - L1) * p} ${C1 + (C2 - C1) * p} ${h})`);
}
const composite = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
// [label, text token, fill: [base, mixed-in, percentage token] | token]
const STATES = [
  ["primary hover", "on-signal", ["signal", "ink", "mix-primary-hover"]],
  ["primary pressed", "on-signal", ["signal", "ink", "mix-primary-press"]],
  ["secondary hover", "ink", ["raised", "ink", "mix-secondary-hover"]],
  ["secondary pressed", "ink", ["raised", "ink", "mix-secondary-press"]],
  ["quiet hover", "ink", ["ground", "ink", "mix-quiet-hover"]],
  ["stop hover", "ground", ["ink", "ground", "mix-stop-hover"]],
  ["stop pressed", "ground", ["ink", "ground", "mix-stop-press"]],
];
const stateRatios = {};
for (const [themeName, theme] of Object.entries(themes)) {
  stateRatios[themeName] = {};
  for (const [label, text, [base, other, token]] of STATES) {
    stateRatios[themeName][label] = ratio(luminance(rgbOf(theme, text)), luminance(mixRgb(theme, base, other, token)));
  }
  // busy: the whole control drops to 85 % opacity over the ground, text and fill alike
  const ground = rgbOf(theme, "ground");
  stateRatios[themeName]["primary busy (85 % opacity)"] = ratio(
    luminance(composite(rgbOf(theme, "on-signal"), ground, 0.85)),
    luminance(composite(rgbOf(theme, "signal"), ground, 0.85)),
  );
  stateRatios[themeName]["secondary busy (85 % opacity)"] = ratio(
    luminance(composite(rgbOf(theme, "ink"), ground, 0.85)),
    luminance(composite(rgbOf(theme, "raised"), ground, 0.85)),
  );
  stateRatios[themeName]["stop busy (85 % opacity)"] = ratio(
    luminance(composite(rgbOf(theme, "ground"), ground, 0.85)),
    luminance(composite(rgbOf(theme, "ink"), ground, 0.85)),
  );
}

const ratios = {};
for (const [themeName, theme] of Object.entries(themes)) {
  ratios[themeName] = {};
  for (const token of [...TEXT, ...GRAPHIC, "on-signal"]) {
    ratios[themeName][token] = {};
    for (const ground of GROUNDS) {
      const against = token === "on-signal" ? "signal" : ground;
      if (token === "on-signal" && ground !== "ground") continue;
      ratios[themeName][token][ground] = ratio(luminance(rgbOf(theme, token)), luminance(rgbOf(theme, against)));
    }
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ...ratios, states: stateRatios }, null, 2));
  process.exit(0);
}

const f2 = (x) => x.toFixed(2);
const pair = (theme, token) => `${f2(ratios[theme][token].ground)} / ${f2(ratios[theme][token].panel)}`;
const marks = (theme) => ["lv-green", "lv-amber", "lv-orange", "lv-red"].map((t) => f2(ratios[theme][t].ground)).join(" / ");

console.log("| Pair | Night (ground / panel) | Sun (ground / panel) | Floor |");
console.log("|---|---|---|---|");
for (const [label, token, floor] of [
  ["ink", "ink", 4.5],
  ["ink-2", "ink-2", 4.5],
  ["ink-3 (labels)", "ink-3", 4.5],
  ["signal", "signal", 4.5],
  ["edge (control boundaries)", "edge", 3],
]) {
  console.log(`| ${label} | ${pair("night", token)} | ${pair("sun", token)} | ${String(floor)} |`);
}
console.log(`| level marks green / amber / orange / red | ${marks("night")} on ground | ${marks("sun")} on ground | 3.0 (graphic) |`);
console.log("");
console.log(`on-signal on signal: night ${f2(ratios.night["on-signal"].ground)}, sun ${f2(ratios.sun["on-signal"].ground)} (floor 4.5)`);
console.log(`focus ring on ground / panel: night ${pair("night", "focus")}, sun ${pair("sun", "focus")} (floor 3.0)`);

console.log("");
console.log("| Control state (text on fill) | Night | Sun | Floor |");
console.log("|---|---|---|---|");
for (const label of Object.keys(stateRatios.night)) {
  console.log(`| ${label} | ${f2(stateRatios.night[label])} | ${f2(stateRatios.sun[label])} | 4.5 |`);
}

let failed = 0;
for (const [themeName, perState] of Object.entries(stateRatios)) {
  for (const [label, value] of Object.entries(perState)) {
    if (value < 4.5) {
      failed++;
      console.error(`BELOW FLOOR: ${themeName} ${label} is ${f2(value)} (floor 4.5)`);
    }
  }
}
for (const [themeName, perToken] of Object.entries(ratios)) {
  for (const [token, perGround] of Object.entries(perToken)) {
    const floor = GRAPHIC.includes(token) ? 3 : 4.5;
    for (const [ground, value] of Object.entries(perGround)) {
      if (value < floor) {
        failed++;
        console.error(`BELOW FLOOR: ${themeName} ${token} on ${ground} is ${f2(value)} (floor ${String(floor)})`);
      }
    }
  }
}
process.exit(failed === 0 ? 0 : 1);

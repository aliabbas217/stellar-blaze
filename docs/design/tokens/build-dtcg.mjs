// Generates tokens.json (W3C Design Tokens Community Group format: $value / $type) from tokens.css,
// so the two files never drift. Semantic colours carry their dark value in $extensions["theme.dark"].
// Usage: node build-dtcg.mjs   (reads ./tokens.css, writes ./tokens.json)
import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const decls = (txt) =>
  Object.fromEntries(
    [...txt.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().replace(/\s+/g, " ")]),
  );
const must = (re, what) => {
  const m = css.match(re);
  if (!m) throw new Error(`build-dtcg: could not find the ${what} block`);
  return m[1];
};

const rootBlocks = [...css.matchAll(/^:root\s*{([\s\S]*?)^}/gm)].map((m) => decls(m[1]));
const primitives = rootBlocks[0];
const light = decls(must(/^:root,\s*\[data-theme="light"\]\s*{([\s\S]*?)^}/m, "light"));
const dark = decls(must(/^\[data-theme="dark"\]\s*{([\s\S]*?)^}/m, "dark"));
const themeIndependent = Object.assign({}, ...rootBlocks.slice(1));

const ref = (v) => v.replace(/var\(--ref-([\w-]+)\)/g, "{ref.$1}").replace(/var\(--([\w-]+)\)/g, "{semantic.$1}");
const typeOf = (k) => {
  if (/^pattern-|^viz-ban$|^viz-ours-band$/.test(k)) return "other";
  if (/^(space|radius|rule|focus-width|focus-offset|rim-width|size|content-max|worker-max|grid-gutter|target|shade|ribbon)/.test(k)) return "dimension";
  if (/^duration/.test(k)) return "duration";
  if (/^(leading|grid-columns)/.test(k)) return "number";
  if (/^(font|measure|tracking)/.test(k)) return "other";
  return "color";
};

const out = {
  $description:
    "Arish Signal rev2 (docs/design/DESIGN.md). Generated from tokens.css by build-dtcg.mjs; do not edit by hand.",
  ref: {},
  semantic: {},
};
for (const [k, v] of Object.entries(primitives)) out.ref[k.replace(/^ref-/, "")] = { $type: "color", $value: v };
for (const [k, v] of Object.entries(light)) {
  out.semantic[k] = {
    $type: typeOf(k),
    $value: ref(v),
    ...(dark[k] ? { $extensions: { "theme.dark": ref(dark[k]) } } : {}),
  };
}
for (const [k, v] of Object.entries(themeIndependent)) {
  if (!out.semantic[k]) out.semantic[k] = { $type: typeOf(k), $value: ref(v) };
}
writeFileSync(new URL("./tokens.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`tokens.json: ${Object.keys(out.ref).length} primitives, ${Object.keys(out.semantic).length} semantic`);

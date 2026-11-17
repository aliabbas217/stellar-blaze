import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { lint } from "@google/design.md/linter";
import { loadTokens, oklchToHex, resolveTheme, rulesOf, tokensFor } from "../../utils/colour";

/*
 * Guards the design contract. DESIGN.md and src/styles/tokens.css carry the same values by hand, the sun block must
 * override exactly what DESIGN.md documents, and the design.md linter reports a broken contrast pair as a warning that
 * still exits 0. Every check here fails the build instead.
 */

const frontendRoot = path.resolve(import.meta.dirname, "../../..");
const designMd = readFileSync(path.join(frontendRoot, "../DESIGN.md"), "utf8");
const globalsCss = readFileSync(path.join(frontendRoot, "src/styles/globals.css"), "utf8");
const report = lint(designMd);

const { css, topLevel, rootTokens, nightRule, sunRule, primitives, semanticNight, sunOverrides, semanticSun } =
  loadTokens();

// ---------- WCAG 2 contrast on the rendered values (the OKLCH to sRGB conversion is in tests/utils/colour.ts) ----------

function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const hex = { night: resolveTheme(semanticNight, primitives), sun: resolveTheme(semanticSun, primitives) } as const;
type Theme = keyof typeof hex;

function color(theme: Theme, name: string): string {
  const value = hex[theme][name];
  if (value === undefined) throw new Error(`no semantic token --${name}`);
  return value;
}

const COLOUR_TOKENS = [
  "ground-deep",
  "ground",
  "panel",
  "raised",
  "slot",
  "hair",
  "edge",
  "ink",
  "ink-2",
  "ink-3",
  "signal",
  "on-signal",
  "focus",
  "scrim",
  "lv-green",
  "lv-amber",
  "lv-orange",
  "lv-red",
  "viz-truth",
  "viz-raw",
  "viz-ours",
  "viz-grid",
] as const;
const LEVEL_MARKS = ["lv-green", "lv-amber", "lv-orange", "lv-red"] as const;

// ---------- DESIGN.md sections that are machine-read ----------

/** DESIGN.md section 3 pairs: the table row labels, mapped to the tokens they measure. */
const TABLE_ROWS: readonly { readonly label: RegExp; readonly tokens: readonly string[]; readonly floor: number }[] = [
  { label: /^ink$/, tokens: ["ink"], floor: 4.5 },
  { label: /^ink-2$/, tokens: ["ink-2"], floor: 4.5 },
  { label: /^ink-3\b/, tokens: ["ink-3"], floor: 4.5 },
  { label: /^signal$/, tokens: ["signal"], floor: 4.5 },
  { label: /^edge\b/, tokens: ["edge"], floor: 3 },
  { label: /^level marks\b/, tokens: LEVEL_MARKS, floor: 3 },
];

function contrastTable(): { cells: string[] }[] {
  const section = /## 3\. Colour[\s\S]*?(?=\n## 4\.)/.exec(designMd)?.[0] ?? "";
  return section
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|[-\s|]+\|$/.test(line))
    .map((line) => ({
      cells: line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim()),
    }));
}

function numbers(cell: string | undefined): number[] {
  return [...(cell ?? "").matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

function documentedSunOverrides(): string[] {
  const paragraph = /\*\*Sun overrides\.\*\*([^\n]*(?:\n(?!\n)[^\n]*)*)/.exec(designMd)?.[1] ?? "";
  return [...paragraph.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1] ?? "");
}

// ---------- tests ----------

describe("tokens.css structure", () => {
  it("defines exactly the twenty-two semantic colours the interface names", () => {
    expect(Object.keys(semanticNight).sort()).toEqual([...COLOUR_TOKENS].sort());
  });

  it("makes every semantic colour of both themes reference a primitive and nothing else", () => {
    for (const [theme, tokens] of [
      ["night", semanticNight],
      ["sun", sunOverrides],
    ] as const) {
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `${theme}: --${name}`).toMatch(/^var\(--ref-[\w-]+\)$/);
        const ref = /^var\(--(ref-[\w-]+)\)$/.exec(value)?.[1];
        expect(primitives, `${theme}: --${name} -> ${String(ref)}`).toHaveProperty(ref ?? "");
      }
    }
  });

  it("is night by default and light only inside sun", () => {
    expect(nightRule["color-scheme"]).toBe("dark");
    expect(sunRule["color-scheme"]).toBe("light");
  });

  it("has the interface's non-colour tokens with the prototype's values", () => {
    // two radii by function: 2 px is for data marks only, 12 and 16 px and the pill are what a hand presses (DESIGN.md 5.1)
    expect(rootTokens["r"]).toBe("2px");
    expect(rootTokens["r-ctl"]).toBe("12px");
    expect(rootTokens["r-card"]).toBe("16px");
    expect(rootTokens["r-pill"]).toBe("999px");
    expect(rootTokens["target"]).toBe("44px");
    expect(rootTokens["target-field"]).toBe("52px");
    expect(rootTokens["target-stop"]).toBe("56px");
    expect(rootTokens["dur-1"]).toBe("150ms");
    expect(rootTokens["dur-2"]).toBe("240ms");
    expect(rootTokens["dur-press"]).toBe("120ms");
    expect(rootTokens["ease"]).toBe("cubic-bezier(0.2, 0, 0, 1)");
    const steps = ["s-1", "s-2", "s-3", "s-4", "s-5", "s-6", "s-8", "s-10", "s-12", "s-16", "s-24"];
    expect(steps.map((name) => rootTokens[name])).toEqual([
      "4px",
      "8px",
      "12px",
      "16px",
      "20px",
      "24px",
      "32px",
      "40px",
      "48px",
      "64px",
      "96px",
    ]);
  });

  it("switches the motion durations off under prefers-reduced-motion", () => {
    const media = topLevel.find((r) => r.selector === "@media (prefers-reduced-motion: reduce)");
    expect(media).toBeDefined();
    const inner = tokensFor(rulesOf(media?.body ?? ""), ":root");
    expect(inner).toEqual({ "dur-1": "0ms", "dur-2": "0ms", "dur-press": "0ms" });
  });

  it("test_type_scale_has_no_13px_step", () => {
    const steps = Object.keys(rootTokens)
      .filter((name) => /^t-\d+$/.test(name))
      .map((name) => [name, rootTokens[name]]);
    expect(steps).toEqual([
      ["t-12", "0.75rem"],
      ["t-14", "0.875rem"],
      ["t-16", "1rem"],
      ["t-18", "1.125rem"],
      ["t-20", "1.25rem"],
      ["t-22", "1.375rem"],
      ["t-24", "1.5rem"],
      ["t-28", "1.75rem"],
      ["t-32", "2rem"],
      ["t-36", "2.25rem"],
      ["t-44", "2.75rem"],
      ["t-48", "3rem"],
      ["t-56", "3.5rem"],
      ["t-64", "4rem"],
      ["t-76", "4.75rem"],
    ]);
    expect(css).not.toMatch(/0\.8125rem|\b13px\b/);
    // The design document drops it as well: no typography token may be 13 px.
    for (const [name, t] of report.designSystem.typography) {
      expect(`${String(t.fontSize?.value)}${t.fontSize?.unit ?? ""}`, `typography.${name}`).not.toBe("0.8125rem");
    }
    expect(designMd).not.toMatch(/12 · 13 · 14/);
  });

  it("test_ur_leading_is_2_5", () => {
    expect(rootTokens["leading-ur"]).toBe("2.5");
    expect(report.designSystem.typography.get("body-ur")?.lineHeight?.value).toBe(2.5);
    expect(globalsCss).toMatch(/:lang\(ur\)\s*\{\s*line-height:\s*var\(--leading-ur\)/);
  });

  it("test_no_hatch_or_shade_tokens_remain", () => {
    const stripped = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [file, source] of [
      ["tokens.css", stripped(css)],
      ["globals.css", stripped(globalsCss)],
    ] as const) {
      expect(source, file).not.toMatch(/--pattern-|--shade-|pattern-level|--level-|--on-level|-soft\b/);
    }
  });
});

describe("DESIGN.md matches tokens.css", () => {
  const designColors = report.designSystem.colors;
  const designHex = (name: string): string => {
    const value = designColors.get(name)?.hex.toLowerCase();
    if (value === undefined) throw new Error(`DESIGN.md has no colors.${name}`);
    return value;
  };
  // The data-series, focus and scrim tokens are aliases or carry alpha: DESIGN.md documents them in prose.
  const NOT_IN_DESIGN_COLORS = ["scrim", "viz-truth", "viz-raw", "viz-ours", "viz-grid", "focus"];

  it("test_tokens_css_equals_design_md: the night colours are the same values", () => {
    for (const name of COLOUR_TOKENS) {
      if (NOT_IN_DESIGN_COLORS.includes(name)) continue;
      expect(designHex(name), `colors.${name}`).toBe(color("night", name));
    }
  });

  it("test_tokens_css_equals_design_md: the sun colours are the same values", () => {
    expect(designHex("sun-ground")).toBe(color("sun", "ground"));
    expect(designHex("sun-ink")).toBe(color("sun", "ink"));
    expect(designHex("sun-signal")).toBe(color("sun", "signal"));
  });

  it("defines primary as the signal colour (the linter requires one)", () => {
    expect(designHex("primary")).toBe(color("night", "signal"));
  });

  it("gives every typography token a size that exists as a --t-* token", () => {
    const sizes = new Set(
      Object.entries(rootTokens)
        .filter(([n]) => /^t-\d+$/.test(n))
        .map(([, v]) => v),
    );
    expect(report.designSystem.typography.size).toBeGreaterThan(0);
    for (const [name, t] of report.designSystem.typography) {
      expect(t.fontSize, `typography.${name}.fontSize`).toBeDefined();
      expect(sizes, `typography.${name}`).toContain(`${String(t.fontSize?.value)}${t.fontSize?.unit ?? ""}`);
    }
  });

  it("only uses line heights and tracking that exist as tokens", () => {
    const leadings = [rootTokens["leading-body"], rootTokens["leading-ur"]];
    const english = tokensFor(topLevel, ":lang(en)");
    const tracking = [english["tracking-display"], english["tracking-wordmark"]];
    let checked = 0;
    for (const [name, t] of report.designSystem.typography) {
      if (t.lineHeight !== undefined) {
        checked++;
        expect(leadings, `typography.${name}.lineHeight`).toContain(String(t.lineHeight.value));
      }
      if (t.letterSpacing !== undefined) {
        expect(tracking, `typography.${name}.letterSpacing`).toContain(
          `${String(t.letterSpacing.value)}${t.letterSpacing.unit}`,
        );
      }
    }
    // body and body-ur: guards against the parser silently dropping line heights (it drops an unquoted number)
    expect(checked).toBe(2);
  });

  it("matches the spacing steps and the corner radius", () => {
    expect(report.designSystem.spacing.size).toBeGreaterThan(0);
    for (const [step, d] of report.designSystem.spacing) {
      expect(d.unit).toBe("px");
      expect(`${String(d.value)}px`, `spacing.${step}`).toBe(rootTokens[`s-${step}`]);
    }
    for (const name of ["r", "r-ctl", "r-card", "r-pill"]) {
      expect(`${String(report.designSystem.rounded.get(name)?.value)}px`, `rounded.${name}`).toBe(rootTokens[name]);
    }
  });

  it("gives each control tier its documented size and radius, and only Stop is a solid ink fill", () => {
    const components = report.designSystem.components;
    const heights = { "button-primary": "52px", "button-secondary": "52px", "button-quiet": "44px", "button-stop": "56px" } as const;
    for (const [name, height] of Object.entries(heights)) {
      const props = components.get(name)?.properties;
      const dimension = props?.get("height") as { value: number; unit: string } | undefined;
      expect(`${String(dimension?.value)}${dimension?.unit ?? ""}`, `components.${name}.height`).toBe(height);
    }
    // the field primary is the signal fill; the ink fill belongs to Stop (and to the selected chip, a pill, not a slab)
    const fill = (name: string) => (components.get(name)?.properties.get("backgroundColor") as { hex: string } | undefined)?.hex;
    expect(fill("button-primary")).toBe(designHex("signal"));
    expect(fill("button-stop")).toBe(designHex("ink"));
    // every other button tier is a tonal fill, never ink
    for (const name of ["button-primary", "button-secondary", "button-quiet"]) expect(fill(name), name).not.toBe(designHex("ink"));
  });

  it("resets letter-spacing to zero for any language that is not English", () => {
    const other = tokensFor(topLevel, ":not(:lang(en))");
    expect(other["tracking-display"]).toMatch(/^0(em)?$/);
    expect(other["tracking-wordmark"]).toMatch(/^0(em)?$/);
  });

  it("test_sun_overrides_exactly_the_documented_set", () => {
    const documented = documentedSunOverrides();
    expect(documented.length).toBeGreaterThan(0);
    expect(Object.keys(sunOverrides).sort()).toEqual([...documented].sort());
    // Every colour is themed: a token the sun block forgot would keep its night value inside a sun subtree.
    expect([...documented].sort()).toEqual([...COLOUR_TOKENS].sort());
  });

  it("has no design.md lint errors or warnings (the CLI exits 0 on warnings, this does not)", () => {
    expect(report.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });
});

describe.each(["night", "sun"] as const)("contrast floors, %s theme", (theme) => {
  // WCAG 2.2 AA: 1.4.3 text 4.5:1, 1.4.11 non-text 3:1. Values are the 8-bit sRGB a browser renders.
  const grounds = ["ground", "panel"] as const;
  const text: [string, string][] = [
    ...grounds.flatMap((g) => ["ink", "ink-2", "ink-3", "signal"].map((fg): [string, string] => [fg, g])),
    ["ink", "raised"],
    ["ink-2", "raised"],
    ["on-signal", "signal"],
  ];
  it.each(text)("text --%s on --%s is at least 4.5:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });

  const graphics: [string, string][] = grounds.flatMap((g) =>
    ["edge", "focus", ...LEVEL_MARKS].map((fg): [string, string] => [fg, g]),
  );
  it.each(graphics)("graphic --%s on --%s is at least 3:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(3);
  });

  it("keeps the slot below the ground, and in night the panel and raised steps above it", () => {
    const lum = (name: string) => relativeLuminance(color(theme, name));
    expect(lum("slot")).toBeLessThan(lum("ground"));
    if (theme === "night") {
      expect(lum("ground")).toBeLessThan(lum("panel"));
      expect(lum("panel")).toBeLessThan(lum("raised"));
    }
  });
});

describe("DESIGN.md section 3 contrast table", () => {
  const rows = contrastTable().filter((r) => TABLE_ROWS.some((spec) => spec.label.test(r.cells[0] ?? "")));

  it("test_contrast_pairs_match_design_md: has one row per measured pair family", () => {
    expect(rows).toHaveLength(TABLE_ROWS.length);
  });

  it.each(TABLE_ROWS.map((spec) => [spec.label.source, spec] as const))(
    "test_contrast_pairs_match_design_md: %s is at or above its floor and within 0.02 of the computed ratio",
    (_label, spec) => {
      const row = rows.find((r) => spec.label.test(r.cells[0] ?? ""));
      expect(row).toBeDefined();
      for (const [theme, cell] of [
        ["night", row?.cells[1]],
        ["sun", row?.cells[2]],
      ] as const) {
        const documented = numbers(cell);
        if (spec.tokens.length === 1) {
          // "a / b": the token on ground, then on panel
          const token = spec.tokens[0] ?? "";
          const grounds = ["ground", "panel"] as const;
          expect(documented, `${token} ${theme}`).toHaveLength(2);
          grounds.forEach((bg, i) => {
            const computed = contrast(color(theme, token), color(theme, bg));
            expect(Math.abs((documented[i] ?? 0) - computed), `${token} on ${bg} ${theme}`).toBeLessThanOrEqual(0.02);
            expect(computed, `${token} on ${bg} ${theme}`).toBeGreaterThanOrEqual(spec.floor);
          });
        } else {
          // four level marks, all on ground
          expect(documented, `level marks ${theme}`).toHaveLength(spec.tokens.length);
          spec.tokens.forEach((token, i) => {
            const computed = contrast(color(theme, token), color(theme, "ground"));
            expect(Math.abs((documented[i] ?? 0) - computed), `${token} ${theme}`).toBeLessThanOrEqual(0.02);
            expect(computed, `${token} ${theme}`).toBeGreaterThanOrEqual(spec.floor);
          });
        }
      }
    },
  );

  it("scripts/contrast.mjs (an independent implementation) prints the same ratios as this test computes", () => {
    const out = execFileSync(process.execPath, [path.join(frontendRoot, "scripts/contrast.mjs"), "--json"], {
      encoding: "utf8",
    });
    const printed = JSON.parse(out) as Record<Theme, Record<string, Record<string, number>>>;
    for (const theme of ["night", "sun"] as const) {
      for (const token of ["ink", "ink-2", "ink-3", "signal", "edge", ...LEVEL_MARKS]) {
        for (const bg of ["ground", "panel"]) {
          const value = printed[theme][token]?.[bg];
          expect(value, `${theme} ${token} on ${bg}`).toBeDefined();
          const computed = contrast(color(theme, token), color(theme, bg));
          expect(Math.abs((value ?? 0) - computed), `${theme} ${token}/${bg}`).toBeLessThanOrEqual(0.005);
        }
      }
    }
  });
});

describe("control state fills (hover, pressed, busy)", () => {
  // A second, independent computation of the mixes in scripts/contrast.mjs: color-mix(in oklch) is a linear mix of the oklch
  // components with the hue along the shorter arc; the mixed oklch value is then rendered with the same converter the rest of this
  // file uses. The percentages are read from tokens.css, so changing a --mix-* token re-runs the check on the new value.
  const oklch = (value: string): [number, number, number] => {
    const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
    if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) throw new Error(`not an oklch() value: ${value}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const primitiveOf = (theme: Theme, token: string): string => {
    const source = theme === "night" ? semanticNight : semanticSun;
    const ref = /^var\(--(ref-[\w-]+)\)$/.exec(source[token] ?? "")?.[1];
    const value = ref === undefined ? undefined : primitives[ref];
    if (value === undefined) throw new Error(`--${token} does not resolve to a primitive`);
    return value;
  };
  const mix = (theme: Theme, base: string, other: string, percent: string): string => {
    const p = Number.parseFloat(rootTokens[percent] ?? "") / 100;
    const [l1, c1, h1] = oklch(primitiveOf(theme, base));
    const [l2, c2, h2] = oklch(primitiveOf(theme, other));
    let dh = h2 - h1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return oklchToHex(`oklch(${String(l1 + (l2 - l1) * p)} ${String(c1 + (c2 - c1) * p)} ${String((h1 + dh * p + 360) % 360)})`);
  };

  const STATES: readonly [string, string, string, string, string][] = [
    ["primary hover", "on-signal", "signal", "ink", "mix-primary-hover"],
    ["primary pressed", "on-signal", "signal", "ink", "mix-primary-press"],
    ["secondary hover", "ink", "raised", "ink", "mix-secondary-hover"],
    ["secondary pressed", "ink", "raised", "ink", "mix-secondary-press"],
    ["quiet hover", "ink", "ground", "ink", "mix-quiet-hover"],
    ["stop hover", "ground", "ink", "ground", "mix-stop-hover"],
    ["stop pressed", "ground", "ink", "ground", "mix-stop-press"],
  ];
  const printed = JSON.parse(
    execFileSync(process.execPath, [path.join(frontendRoot, "scripts/contrast.mjs"), "--json"], { encoding: "utf8" }),
  ) as { states: Record<Theme, Record<string, number>> };

  describe.each(["night", "sun"] as const)("%s", (theme) => {
    it.each(STATES)("%s keeps its text at 4.5:1 or more and scripts/contrast.mjs agrees", (label, text, base, other, percent) => {
      const computed = contrast(color(theme, text), mix(theme, base, other, percent));
      expect(computed, label).toBeGreaterThanOrEqual(4.5);
      expect(Math.abs((printed.states[theme][label] ?? 0) - computed), `${label}: script vs test`).toBeLessThanOrEqual(0.02);
    });

    it("keeps every busy control (85 % opacity over the ground) at 4.5:1", () => {
      for (const label of ["primary busy (85 % opacity)", "secondary busy (85 % opacity)", "stop busy (85 % opacity)"]) {
        expect(printed.states[theme][label], `${theme} ${label}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});

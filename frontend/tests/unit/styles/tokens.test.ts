import { readFileSync } from "node:fs";
import path from "node:path";
import { lint } from "@google/design.md/linter";
import { loadTokens, resolveTheme, tokensFor } from "../../utils/colour";

/*
 * Guards the design contract. DESIGN.md and src/styles/tokens.css carry the same values by
 * hand, tokens.css declares the dark theme twice, and the design.md linter reports a broken
 * contrast pair as a warning that still exits 0. Every check here fails the build instead.
 */

const frontendRoot = path.resolve(import.meta.dirname, "../../..");
const designMd = readFileSync(path.join(frontendRoot, "../DESIGN.md"), "utf8");
const report = lint(designMd);

const {
  topLevel,
  rootTokens,
  darkOverride,
  darkSystem,
  primitives,
  semanticLight,
  semanticDark,
} = loadTokens();

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

// ---------- theme resolution ----------

const hex = { light: resolveTheme(semanticLight, primitives), dark: resolveTheme(semanticDark, primitives) } as const;

function color(theme: "light" | "dark", name: string): string {
  const value = hex[theme][name];
  if (value === undefined) throw new Error(`no semantic token --${name}`);
  return value;
}

const LEVELS = ["green", "amber", "orange", "red"] as const;

// ---------- tests ----------

describe("tokens.css structure", () => {
  it("defines the ten base and sixteen level semantic colours", () => {
    expect(Object.keys(semanticLight)).toHaveLength(10 + 4 * 4);
  });

  it("keeps the dark override and the system-default dark block identical", () => {
    expect(darkSystem).toEqual(darkOverride);
    expect(Object.keys(darkOverride).length).toBeGreaterThan(0);
  });

  it("only overrides tokens that exist in the light set", () => {
    for (const name of Object.keys(darkOverride)) {
      expect(semanticLight, `--${name} is overridden in dark but not defined in light`).toHaveProperty(name);
    }
  });

  it("makes every semantic colour reference a primitive and nothing else", () => {
    for (const [theme, tokens] of [
      ["light", semanticLight],
      ["dark overrides", darkOverride],
      ["system dark overrides", darkSystem],
    ] as const) {
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `${theme}: --${name}`).toMatch(/^var\(--ref-[\w-]+\)$/);
        const ref = /^var\(--(ref-[\w-]+)\)$/.exec(value)?.[1];
        expect(primitives, `${theme}: --${name} -> ${String(ref)}`).toHaveProperty(ref ?? "");
      }
    }
  });
});

describe("DESIGN.md matches tokens.css", () => {
  // The design.md linter requires a colour called `primary`; in CSS it is the action colour.
  const cssName = (designName: string) =>
    designName === "primary" ? "action" : designName === "on-primary" ? "on-action" : designName;

  it("defines exactly the semantic colours, with the same values as the light theme", () => {
    const designColors = report.designSystem.colors;
    expect([...designColors.keys()].map(cssName).sort()).toEqual(Object.keys(semanticLight).sort());
    for (const [designName, resolved] of designColors) {
      expect(resolved.hex.toLowerCase(), `colors.${designName}`).toBe(color("light", cssName(designName)));
    }
  });

  it("gives every typography token the size of its --size-* token", () => {
    for (const [name, t] of report.designSystem.typography) {
      expect(t.fontSize, `typography.${name}.fontSize`).toBeDefined();
      expect(`${String(t.fontSize?.value)}${t.fontSize?.unit ?? ""}`, `typography.${name}`).toBe(
        rootTokens[`size-${name}`],
      );
    }
  });

  it("only uses line heights and tracking that exist as tokens", () => {
    const leadings = [rootTokens["leading-solid"], rootTokens["leading-body"]];
    const tracking = tokensFor(topLevel, ":lang(en)")["tracking-signage"];
    let checked = 0;
    for (const [name, t] of report.designSystem.typography) {
      if (t.lineHeight !== undefined) {
        checked++;
        expect(leadings, `typography.${name}.lineHeight`).toContain(String(t.lineHeight.value));
      }
      if (t.letterSpacing !== undefined) {
        expect(`${String(t.letterSpacing.value)}${t.letterSpacing.unit}`, `typography.${name}.letterSpacing`).toBe(
          tracking,
        );
      }
    }
    // numeral, display, lead, body, label: guards against the parser silently dropping line heights again
    expect(checked).toBe(5);
  });

  it("matches the spacing steps and the corner radius", () => {
    for (const [step, d] of report.designSystem.spacing) {
      const rem = Number.parseFloat(rootTokens[`space-${step}`] ?? "NaN");
      expect(d.unit).toBe("px");
      expect(d.value, `spacing.${step}`).toBe(rem * 16);
    }
    expect(report.designSystem.rounded.get("sign")?.value).toBe(Number.parseFloat(rootTokens["radius-sign"] ?? "NaN"));
  });

  it("resets letter-spacing to zero for any language that is not English", () => {
    expect(tokensFor(topLevel, ":not(:lang(en))")["tracking-signage"]).toMatch(/^0(em)?$/);
  });

  it("has no design.md lint errors or warnings (the CLI exits 0 on warnings, this does not)", () => {
    expect(report.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });
});

describe.each(["light", "dark"] as const)("contrast floors, %s theme", (theme) => {
  // WCAG 2.2 AA: 1.4.3 text 4.5:1, 1.4.11 non-text 3:1. Values are the 8-bit sRGB a browser renders.
  const text: [string, string][] = [
    ["ink", "surface"],
    ["ink", "surface-raised"],
    ["ink-muted", "surface"],
    ["ink-muted", "surface-raised"],
    ["on-action", "action"],
    ...LEVELS.flatMap((l): [string, string][] => [
      [`on-level-${l}`, `level-${l}`],
      [`on-level-${l}-soft`, `level-${l}-soft`],
    ]),
  ];
  it.each(text)("text --%s on --%s is at least 4.5:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });

  const edges: [string, string][] = [
    ["control", "surface"],
    ["control", "surface-raised"],
    ["focus", "surface"],
    ["focus", "surface-raised"],
  ];
  it.each(edges)("edge --%s against --%s is at least 3:1", (fg, bg) => {
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(3);
  });
});

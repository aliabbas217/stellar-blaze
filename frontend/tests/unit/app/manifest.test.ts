// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { GET } from "@/app/[locale]/manifest.webmanifest/route";
import { MANIFEST_COLORS, manifestFor, type ManifestTranslator } from "@/features/pwa/manifest";
import { dirFor } from "@/i18n/direction";
import type { Messages } from "@/i18n/request";
import { routing, type Locale } from "@/i18n/routing";

/*
 * The per-locale web app manifest. Installability needs the icons and display mode right; the locale review
 * focus needs start_url to carry the locale (an installed Urdu app must open on /ur/..., never /en/...).
 */

// The real translator on the real message files; only the request-scoped lookup of next-intl/server is replaced.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { default: en } = await import("../../../messages/en.json");
  const { default: ar } = await import("../../../messages/ar.json");
  const { default: ur } = await import("../../../messages/ur.json");
  const { default: hi } = await import("../../../messages/hi.json");
  const { default: bn } = await import("../../../messages/bn.json");
  const { default: ne } = await import("../../../messages/ne.json");
  const all: Record<Locale, Messages> = { en, ar, ur, hi, bn, ne };
  return {
    getTranslations: ({ locale, namespace }: { locale: Locale; namespace: "common" }) =>
      Promise.resolve(createTranslator({ locale, messages: all[locale], namespace })),
  };
});

const frontendRoot = path.resolve(import.meta.dirname, "../../..");
const tokensCss = readFileSync(path.join(frontendRoot, "src/styles/tokens.css"), "utf8");

async function translatorFor(locale: Locale): Promise<ManifestTranslator> {
  const { getTranslations } = await import("next-intl/server");
  return getTranslations({ locale, namespace: "common" });
}

// ---------- the colours: the manifest holds sRGB hex, tokens.css holds OKLCH; they must stay the same colour ----------

/** OKLCH to 8-bit sRGB hex (the same maths as tests/unit/styles/tokens.test.ts, which keeps its copy private). */
function oklchToHex(value: string): string {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) throw new Error(`not an oklch() value: ${value}`);
  const L = Number(m[1]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = Number(m[2]) * Math.cos(h);
  const b = Number(m[2]) * Math.sin(h);
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

function primitive(name: string): string {
  const match = new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`).exec(tokensCss);
  if (match?.[1] === undefined) throw new Error(`tokens.css has no --${name}`);
  return match[1];
}

/** The primitive a semantic token points at in the light rule (":root, [data-theme=\"light\"]") or the dark override. */
function semantic(theme: "light" | "dark", token: string): string {
  const selector = theme === "light" ? ':root,\\s*\\[data-theme="light"\\]' : '\\[data-theme="dark"\\]';
  const rule = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(tokensCss.replace(/\/\*[\s\S]*?\*\//g, ""));
  const body = rule?.[1];
  if (body === undefined) throw new Error(`tokens.css has no ${theme} rule`);
  const ref = new RegExp(`--${token}:\\s*var\\(--(ref-[\\w-]+)\\)`).exec(body)?.[1];
  if (ref === undefined) throw new Error(`--${token} is not a var(--ref-*) in the ${theme} rule`);
  return primitive(ref);
}

describe("MANIFEST_COLORS", () => {
  it("is the light --surface (sand-50) token, for the manifest and the light browser chrome", () => {
    expect(MANIFEST_COLORS.light).toBe(oklchToHex(semantic("light", "surface")));
    expect(MANIFEST_COLORS.light).toBe(oklchToHex(primitive("ref-sand-50")));
  });

  it("is the dark --surface (sand-950) token, for the dark browser chrome", () => {
    expect(MANIFEST_COLORS.dark).toBe(oklchToHex(semantic("dark", "surface")));
    expect(MANIFEST_COLORS.dark).toBe(oklchToHex(primitive("ref-sand-950")));
  });
});

// ---------- manifestFor ----------

describe("manifestFor", () => {
  it("builds the Arabic manifest: right to left, locale-prefixed start_url, one origin-wide scope", async () => {
    const manifest = manifestFor("ar", await translatorFor("ar"));
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("ar");
    expect(manifest.start_url).toBe("/ar/worker?source=pwa");
    expect(manifest.scope).toBe("/");
    expect(manifest.id).toBe("/worker");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.theme_color).toBe(MANIFEST_COLORS.light);
    expect(manifest.background_color).toBe(MANIFEST_COLORS.light);
  });

  it("takes the name and the description from the locale's own messages", async () => {
    const t = await translatorFor("ar");
    const manifest = manifestFor("ar", t);
    expect(manifest.name).toBe(t("appName"));
    expect(manifest.short_name).toBe(t("appName"));
    expect(manifest.description).toBe(t("appDescription"));
    expect(manifest.description).toMatch(/[؀-ۿ]/);
  });

  it("has a 192, a 512 and one maskable 512 icon, all under /icons/", async () => {
    const { icons = [] } = manifestFor("en", await translatorFor("en"));
    expect(icons.map((icon) => [icon.sizes, icon.purpose ?? "any"])).toEqual([
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]);
    expect(icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(1);
    for (const icon of icons) {
      expect(icon.src.startsWith("/icons/")).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });

  it.each(routing.locales)("%s: lang, dir, start_url and a non-empty name", async (locale) => {
    const manifest = manifestFor(locale, await translatorFor(locale));
    expect(manifest.lang).toBe(locale);
    expect(manifest.dir).toBe(dirFor(locale));
    expect(manifest.start_url).toBe(`/${locale}/worker?source=pwa`);
    expect(manifest.name?.trim()).not.toBe("");
    expect(manifest.description?.trim()).not.toBe("");
  });
});

// ---------- the icon files the manifest names ----------

interface Png {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  /** Raw bytes of the top-left pixel (the first scanline's first pixel is the same in every PNG filter type). */
  readonly topLeft: readonly number[];
}

function readPng(file: string): Png {
  const buffer = readFileSync(file);
  expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer.readUInt8(24);
  const colorType = buffer.readUInt8(25);
  const idat: Buffer[] = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  return { width, height, bitDepth, colorType, topLeft: [...raw.subarray(1, 1 + channels)] };
}

describe("the icon files", () => {
  const icons = manifestFor("en", (key: string) => key).icons ?? [];

  it.each(icons.map((icon) => [icon.src, icon.sizes ?? ""] as const))("%s is a PNG of exactly %s", (src, sizes) => {
    const png = readPng(path.join(frontendRoot, "public", src));
    expect(`${String(png.width)}x${String(png.height)}`).toBe(sizes);
    expect(png.bitDepth).toBe(8);
  });

  it.each(icons.map((icon) => icon.src))("%s is full-bleed sand-50, so a maskable crop shows no transparent corner", (src) => {
    const { topLeft, colorType } = readPng(path.join(frontendRoot, "public", src));
    const [r = -1, g = -1, b = -1, a = 255] = topLeft;
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    expect(hex).toBe(MANIFEST_COLORS.light);
    expect(colorType === 2 || a === 255).toBe(true);
  });
});

// ---------- GET /<locale>/manifest.webmanifest ----------

function contextFor(locale: string) {
  return { params: Promise.resolve({ locale }) } as RouteContext<"/[locale]/manifest.webmanifest">;
}

describe("GET /[locale]/manifest.webmanifest", () => {
  it.each(routing.locales)("serves the %s manifest as application/manifest+json", async (locale) => {
    const response = await GET(new Request(`https://worker.example/${locale}/manifest.webmanifest`), contextFor(locale));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/manifest+json");
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(manifestFor(locale, await translatorFor(locale)))));
  });

  it.each(["xx", "UR", "urdu"])("answers 404 for the unknown locale %j", async (locale) => {
    const response = await GET(new Request(`https://worker.example/${locale}/manifest.webmanifest`), contextFor(locale));
    expect(response.status).toBe(404);
  });
});

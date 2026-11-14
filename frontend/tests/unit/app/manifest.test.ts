// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { GET } from "@/app/[locale]/manifest.webmanifest/route";
import { APPLE_TOUCH_ICON, MANIFEST_COLORS, manifestFor, type ManifestTranslator } from "@/features/pwa/manifest";
import { dirFor } from "@/i18n/direction";
import type { Messages } from "@/i18n/request";
import { routing, type Locale } from "@/i18n/routing";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { themeHex } from "../../utils/colour";

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

async function translatorFor(locale: Locale): Promise<ManifestTranslator> {
  const { getTranslations } = await import("next-intl/server");
  return getTranslations({ locale, namespace: "common" });
}

// ---------- the colours: the manifest holds sRGB hex, tokens.css holds OKLCH; they must stay the same colour ----------

describe("MANIFEST_COLORS", () => {
  it("is the night --ground token, for the manifest and the default browser chrome", () => {
    expect(MANIFEST_COLORS.night).toBe(themeHex().night["ground"]);
  });

  it("is the sun --ground token, for the browser chrome while sun mode is on", () => {
    expect(MANIFEST_COLORS.sun).toBe(themeHex().sun["ground"]);
  });

  it("is the one set of colours the theme script and the sun toggle write to the theme-color meta", () => {
    expect(MANIFEST_COLORS).toBe(THEME_COLORS);
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
    expect(manifest.theme_color).toBe(MANIFEST_COLORS.night);
    expect(manifest.background_color).toBe(MANIFEST_COLORS.night);
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

  it("offers the 192 icon as the apple-touch-icon, so iOS does not fall back to a page screenshot", async () => {
    const { icons = [] } = manifestFor("en", await translatorFor("en"));
    expect(APPLE_TOUCH_ICON).toEqual({ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" });
    expect(icons.map((icon) => icon.src)).toContain(APPLE_TOUCH_ICON.url);
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

  // The F1 artwork (amber drop on sand-50). Qaylula has no sand: the icons keep their name and size and are redrawn on the
  // night ground in a later task (parked in the Task 1 report); until then this pins the files as they are.
  const ICON_BACKGROUND_F1 = "#fbf6ee";

  it.each(icons.map((icon) => icon.src))("%s is full-bleed, so a maskable crop shows no transparent corner", (src) => {
    const { topLeft, colorType } = readPng(path.join(frontendRoot, "public", src));
    const [r = -1, g = -1, b = -1, a = 255] = topLeft;
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    expect(hex).toBe(ICON_BACKGROUND_F1);
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

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_MANIFEST } from "@/features/judge/manifest.generated";

const ROOT = process.cwd();
const STATIC = path.join(ROOT, "data", "static");
const PUBLIC_STATIC = path.join(ROOT, "public", "data", "static");

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const dataFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "MANIFEST.json").sort();

interface ManifestJson {
  readonly files: Readonly<Record<string, { sha256: string; bytes: number; source: string; label: string }>>;
}

describe("data manifest", () => {
  const manifest = JSON.parse(readFileSync(path.join(STATIC, "MANIFEST.json"), "utf8")) as ManifestJson;

  it("test_manifest_matches_files: every static file's sha-256 in MANIFEST.json and manifest.generated.ts is the file's own", () => {
    const files = dataFiles(STATIC);
    expect(files).toHaveLength(4);
    expect(Object.keys(manifest.files).sort()).toEqual(files.map((f) => `static/${f}`));
    for (const file of files) {
      const entry = manifest.files[`static/${file}`];
      expect(entry?.sha256, file).toBe(sha(path.join(STATIC, file)));
      expect(entry?.bytes, file).toBe(readFileSync(path.join(STATIC, file)).byteLength);
      expect(DATA_MANIFEST[`static/${file}` as keyof typeof DATA_MANIFEST], file).toEqual(entry);
    }
  });

  it("records a source and a label for every file", () => {
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(entry.source.trim(), file).not.toBe("");
      expect(["RECORDED", "REAL", "REAL weather + assumed crew", "SIMULATED"], file).toContain(entry.label);
    }
  });

  it("serves byte-identical copies from public/data/static, the files the browser recounts", () => {
    expect(dataFiles(PUBLIC_STATIC)).toEqual(dataFiles(STATIC));
    for (const file of dataFiles(STATIC)) {
      expect(sha(path.join(PUBLIC_STATIC, file)), file).toBe(sha(path.join(STATIC, file)));
    }
  });

  it("is what build-data-manifest.mjs --check accepts (no drift between files, manifest, generated module and copies)", () => {
    const run = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/build-data-manifest.mjs", "--check"],
      { cwd: ROOT, encoding: "utf8", env: { ...process.env, SB_REQUIRE_SCORED: "" } },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});

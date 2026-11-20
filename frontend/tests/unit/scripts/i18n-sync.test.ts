import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogueProblems, placeholders, richTags } from "../../../scripts/i18n-sync.mjs";

/*
 * scripts/i18n-sync.mjs (F2 Task 22): copies the keys a view task added to en into the five other catalogues as English text and
 * records them in messages/review-manifest.json as "untranslated"; `--check` is the CI gate. These run the real CLI against a
 * throw-away copy of messages/, so the real catalogues are never touched.
 */

const FRONTEND = process.cwd();
const LOCALES = ["en", "ar", "ur", "hi", "bn", "ne"] as const;
let root: string;

type Tree = { [key: string]: string | Tree };

const messagesPath = (name: string) => path.join(root, "messages", name);
const readJson = (name: string): Tree => JSON.parse(readFileSync(messagesPath(name), "utf8")) as Tree;
const writeJson = (name: string, value: unknown): void => {
  writeFileSync(messagesPath(name), `${JSON.stringify(value, null, 2)}\n`);
};

function run(...args: string[]) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(FRONTEND, "scripts", "i18n-sync.mjs"), "--root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, SB_REQUIRE_TRANSLATED: "" },
  });
}

function seed(): void {
  mkdirSync(path.join(root, "messages"), { recursive: true });
  const en = { _meta: { review_status: "source", safety_keys: ["worker.stop.line"] }, worker: { stop: { line: "Stop work, <bdi>{crew}</bdi>" }, hello: "Hello {name}" }, judge: { scoreboard: { title: "Scoreboard" } } };
  writeJson("en.json", en);
  for (const locale of LOCALES.slice(1)) {
    writeJson(`${locale}.json`, { _meta: { review_status: "machine-draft" }, worker: { stop: { line: `${locale} <bdi>{crew}</bdi>` }, hello: `${locale} {name}` }, judge: { scoreboard: { title: "Scoreboard" } } });
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "i18n-sync-"));
  seed();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("i18n-sync", () => {
  it("writes the manifest on the first run and is idempotent on the second (same bytes)", () => {
    expect(run().status).toBe(0);
    const first = readFileSync(messagesPath("review-manifest.json"), "utf8");
    const catalogueBytes = LOCALES.map((locale) => readFileSync(messagesPath(`${locale}.json`), "utf8"));
    expect(run().status).toBe(0);
    expect(readFileSync(messagesPath("review-manifest.json"), "utf8")).toBe(first);
    expect(LOCALES.map((locale) => readFileSync(messagesPath(`${locale}.json`), "utf8"))).toEqual(catalogueBytes);
    expect(run("--check").status).toBe(0);
  });

  it("copies a key added to en into the five catalogues as English text and lists it as untranslated (safety read from en)", () => {
    run();
    const en = readJson("en.json") as unknown as { worker: Tree; _meta: { safety_keys: string[] } };
    en.worker["added"] = "Drink water, {name}";
    en._meta.safety_keys.push("worker.added");
    writeJson("en.json", en);
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    for (const locale of LOCALES.slice(1)) {
      expect((readJson(`${locale}.json`) as { worker: Tree }).worker["added"], locale).toBe("Drink water, {name}");
    }
    const manifest = JSON.parse(readFileSync(messagesPath("review-manifest.json"), "utf8")) as { locales: Record<string, { untranslated?: { safety: string[]; other: string[] } }> };
    for (const locale of LOCALES.slice(1)) expect(manifest.locales[locale]?.untranslated?.safety, locale).toEqual(["worker.added"]);
    expect(run("--check").status, "check passes without the release flag").toBe(0);
  });

  it("--check with SB_REQUIRE_TRANSLATED=1 fails while a Tier 1 key is still English, and passes a Tier 2 key that is", () => {
    run();
    const en = readJson("en.json") as { worker: Tree };
    en.worker["added"] = "New line";
    writeJson("en.json", en);
    run();
    const flagged = spawnSync(process.execPath, [path.join(FRONTEND, "scripts", "i18n-sync.mjs"), "--root", root, "--check"], { encoding: "utf8", env: { ...process.env, SB_REQUIRE_TRANSLATED: "1" } });
    expect(flagged.status).toBe(1);
    expect(flagged.stderr).toMatch(/untranslated/);
    expect(flagged.stderr).toMatch(/worker\.added/);
  });

  it("--check exits non-zero when a key is missing from a catalogue", () => {
    run();
    const ur = readJson("ur.json") as { worker: Tree };
    delete ur.worker["hello"];
    writeJson("ur.json", ur);
    const result = run("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ur: missing worker\.hello/);
  });

  it("--check exits non-zero when a catalogue has a key en does not", () => {
    run();
    const hi = readJson("hi.json") as { worker: Tree };
    hi.worker["stray"] = "stray";
    writeJson("hi.json", hi);
    const result = run("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/hi: extra worker\.stray/);
  });

  it("--check exits non-zero when a placeholder set or a rich tag differs from en", () => {
    run();
    const ne = readJson("ne.json") as { worker: Tree & { stop: Tree } };
    ne.worker["hello"] = "ne {nom}";
    writeJson("ne.json", ne);
    const placeholder = run("--check");
    expect(placeholder.status).toBe(1);
    expect(placeholder.stderr).toMatch(/ne: worker\.hello placeholders/);
    ne.worker["hello"] = "ne {name}";
    ne.worker.stop["line"] = "ne {crew}";
    writeJson("ne.json", ne);
    const tag = run("--check");
    expect(tag.status).toBe(1);
    expect(tag.stderr).toMatch(/ne: worker\.stop\.line tags/);
  });

  it("--check exits non-zero when the manifest is stale", () => {
    run();
    const bn = readJson("bn.json") as { worker: Tree };
    bn.worker["hello"] = "Hello {name}"; // back to en's text: the manifest says machine-draft, the catalogue says untranslated
    writeJson("bn.json", bn);
    const result = run("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/review-manifest\.json is stale/);
  });

  it("sync refuses (and writes nothing) when a catalogue has a key en does not", () => {
    run();
    const before = readFileSync(messagesPath("review-manifest.json"), "utf8");
    const ar = readJson("ar.json") as { worker: Tree };
    ar.worker["stray"] = "stray";
    writeJson("ar.json", ar);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ar: extra worker\.stray/);
    expect(readFileSync(messagesPath("review-manifest.json"), "utf8")).toBe(before);
  });

  it("keeps a reviewer's `reviewed` status and a shortened-for-fit note across a sync, with the real lengths", () => {
    run();
    const manifestFile = messagesPath("review-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { locales: Record<string, Record<string, unknown>> };
    const ar = manifest.locales["ar"] as { "machine-draft": { safety: string[]; other: string[] }; reviewed?: { safety: string[]; other: string[] }; notes?: unknown[] };
    ar["machine-draft"].other = ar["machine-draft"].other.filter((key) => key !== "worker.hello");
    ar.reviewed = { safety: [], other: ["worker.hello"] };
    ar.notes = [{ key: "worker.stop.line", note: "shortened for fit; meaning exactly kept", english_len: 999, translated_len: 999 }];
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(run().status).toBe(0);
    const after = JSON.parse(readFileSync(manifestFile, "utf8")) as { locales: { ar: { reviewed?: { other: string[] }; notes?: { key: string; english_len: number; translated_len: number }[] } } };
    expect(after.locales.ar.reviewed?.other).toEqual(["worker.hello"]);
    expect(after.locales.ar.notes).toEqual([{ key: "worker.stop.line", note: "shortened for fit; meaning exactly kept", english_len: "Stop work, <bdi>{crew}</bdi>".length, translated_len: "ar <bdi>{crew}</bdi>".length }]);
  });
});

describe("i18n-sync helpers", () => {
  it("placeholders reads names, with a plural or select argument counted by its name", () => {
    expect(placeholders("Work {work} min, rest {rest}")).toEqual(["rest", "work"]);
    expect(placeholders("{n, plural, one {# day} other {# days}}")).toEqual(["n"]);
    expect(placeholders("no arguments")).toEqual([]);
  });

  it("richTags keeps every tag with its multiplicity", () => {
    expect(richTags("<bdi>{a}</bdi> and <bdi>{b}</bdi>")).toEqual(["</bdi>", "</bdi>", "<bdi>", "<bdi>"]);
    expect(richTags("plain")).toEqual([]);
  });
});

describe("the claims rule for a translated locale (Arabic, ADR 0083 amendment 2026-11-20)", () => {
  const catalogues = (ar: string, ur: string) => ({
    en: { judge: { scoreboard: { x: "Missed 12 hours on 3 days" } } },
    ar: { judge: { scoreboard: { x: ar } } },
    ur: { judge: { scoreboard: { x: ur } } },
    hi: { judge: { scoreboard: { x: "Missed 12 hours on 3 days" } } },
    bn: { judge: { scoreboard: { x: "Missed 12 hours on 3 days" } } },
    ne: { judge: { scoreboard: { x: "Missed 12 hours on 3 days" } } },
  });

  it("lets Arabic differ from en on a claims key when every number is kept", () => {
    expect(catalogueProblems(catalogues("فاتت 12 ساعة في 3 أيام", "Missed 12 hours on 3 days") as never)).toEqual([]);
  });

  it("fails an Arabic claims key that drops, changes or adds a number", () => {
    for (const bad of ["فاتت ساعات في 3 أيام", "فاتت 13 ساعة في 3 أيام", "فاتت 12 ساعة في 3 أيام من 30"]) {
      expect(catalogueProblems(catalogues(bad, "Missed 12 hours on 3 days") as never).join("|"), bad).toMatch(/ar: judge.scoreboard.x numbers/);
    }
  });

  it("still holds the other four languages to en's text", () => {
    expect(catalogueProblems(catalogues("فاتت 12 ساعة في 3 أيام", "فاتت 12 ساعة في 3 أيام") as never).join("|")).toMatch(/ur: judge.scoreboard.x is a claims-surface string/);
  });
});

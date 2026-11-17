import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SW_STRINGS_FILE, pushStringsOf, readAllMessages, renderSwStrings } from "../../../../scripts/build-sw-strings.ts";
import { SW_STRINGS } from "@/features/push/sw-strings";
import { routing } from "@/i18n/routing";

/*
 * sw-strings.ts is generated from messages/*.json and committed (the service worker bundles it). Two guards:
 *  - drift: the committed file is byte for byte what the generator produces from the current messages, so a message
 *    edited without running `pnpm build` (prebuild) fails here instead of shipping stale notification text;
 *  - the generator refuses what the worker cannot render (its substitution is `{level}` only, it is not ICU).
 */

describe("sw-strings.ts", () => {
  it("equals what the messages produce (run `node scripts/build-sw-strings.ts` after editing push messages)", () => {
    const committed = readFileSync(SW_STRINGS_FILE, "utf8");
    expect(committed).toBe(renderSwStrings(readAllMessages()));
  });

  it("reads the locale catalogues and nothing else in messages/ (review-manifest.json lives there and is not a locale)", () => {
    expect(Object.keys(readAllMessages()).sort()).toEqual([...routing.locales].sort());
  });

  it("test_locale_file_pattern_escapes_the_dot: a file whose name only looks like <xx>.json (any character before 'json') is not read", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "t22f-sw-strings-"));
    try {
      writeFileSync(path.join(dir, "en.json"), JSON.stringify({ ok: true }));
      writeFileSync(path.join(dir, "enxjson"), "this is not JSON and must never be parsed");
      writeFileSync(path.join(dir, "ab-json"), "{");
      expect(Object.keys(readAllMessages(dir))).toEqual(["en"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives the pre-commit fixers unchanged: one final newline, no trailing whitespace, LF only", () => {
    const committed = readFileSync(SW_STRINGS_FILE, "utf8");
    expect(committed.endsWith("\n")).toBe(true);
    expect(committed.endsWith("\n\n")).toBe(false);
    expect(committed).not.toMatch(/[ \t]+$/m);
    expect(committed).not.toContain("\r");
  });

  it("is the file the generator writes, next to the code that reads it", () => {
    expect(path.relative(path.resolve(import.meta.dirname, "../../../.."), SW_STRINGS_FILE).split(path.sep).join("/")).toBe(
      "src/features/push/sw-strings.ts",
    );
  });

  it("has strings for exactly the routed locales", () => {
    expect(Object.keys(SW_STRINGS).sort()).toEqual([...routing.locales].sort());
  });
});

describe("pushStringsOf", () => {
  const messages = {
    common: { appName: "App" },
    push: {
      title: { site: "Site: {level}", crew: "Crew: {level}" },
      body: "Open the app.",
      level: { green: "G", amber: "A", orange: "O", red: "R" },
    },
  };

  it("reads the push namespace and the app name", () => {
    expect(pushStringsOf(messages, "xx")).toEqual({ appName: "App", ...messages.push });
  });

  it("throws, naming the key, when the app name is missing or empty", () => {
    expect(() => pushStringsOf({ ...messages, common: {} }, "xx")).toThrow(/xx.json common.appName/);
    expect(() => pushStringsOf({ ...messages, common: { appName: " " } }, "xx")).toThrow(/xx.json common.appName/);
    expect(() => pushStringsOf({ push: messages.push }, "xx")).toThrow(/xx.json common/);
  });

  it("throws, naming the locale and the key, when a key is missing", () => {
    expect(() => pushStringsOf({ ...messages, push: { ...messages.push, body: undefined } }, "xx")).toThrow(/xx\.json push\.body/);
    expect(() => pushStringsOf({}, "xx")).toThrow(/xx\.json push/);
  });

  it("throws when a title uses a placeholder the worker cannot fill", () => {
    const broken = { ...messages, push: { ...messages.push, title: { site: "Site: {level} at {time}", crew: "Crew: {level}" } } };
    expect(() => pushStringsOf(broken, "xx")).toThrow(/\{time\}/);
  });

  it("throws when the body uses a placeholder (the worker fills none there)", () => {
    expect(() => pushStringsOf({ ...messages, push: { ...messages.push, body: "Open {app}" } }, "xx")).toThrow(/\{app\}/);
  });
});

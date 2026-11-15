// @vitest-environment node
import { ESLint, Linter } from "eslint";
import { defineConfig } from "eslint/config";
import path from "node:path";
import tseslint from "typescript-eslint";

/*
 * Guards the route-group isolation of ADR 0009 section 7 (eslint.config.mjs): on-device personal data lives in
 * the worker group, so supervisor and HSE code must not reach it, directly or through shared code.
 *
 * Two things are checked against the real eslint.config.mjs, not a copy of it:
 *  1. The options ESLint resolves for a path. no-restricted-imports and no-restricted-syntax options replace, never
 *     merge, across config blocks that match the same file, so a later project-wide block (say, one banning
 *     next/link) would silently switch the isolation off while lint stays green. Resolving the config per path
 *     catches that.
 *  2. What the resolved rules do to source text (Linter.verify with the TypeScript parser, no type information
 *     needed): the alias and relative spellings, type imports, bare sibling imports, dynamic import() and
 *     require(), shared code, and imports that must stay allowed.
 */

const cwd = path.resolve(import.meta.dirname, "../../..");
const eslint = new ESLint({ cwd });

type Rules = NonNullable<Linter.Config["rules"]>;

const IMPORTS = "no-restricted-imports";
const SYNTAX = "no-restricted-syntax";

const WORKER_ROUTE = "src/app/[locale]/(worker)/worker/page.tsx";
const SUPERVISOR_ROUTE = "src/app/[locale]/(supervisor)/supervisor/page.tsx";
const HSE_ROUTE = "src/app/[locale]/(hse)/hse/page.tsx";
const WORKER_FEATURE_NAMES = ["today", "profile", "risk", "push", "alert", "unwell"];
const WORKER_FEATURES = WORKER_FEATURE_NAMES.map((name) => `src/features/${name}/x.ts`);
const SUPERVISOR_FEATURE = "src/features/supervisor/x.ts";
// The judge route group, the locale landing page and the judge feature (F2 Task 3): public, static, no personal data. They
// may not import worker, supervisor or HSE code. The demo feature is neutral ground every group uses, so it may not import any.
const JUDGE_ROUTE = "src/app/[locale]/(judge)/replay/layout.tsx";
const JUDGE_LIVE_ROUTE = "src/app/[locale]/(judge)/replay/(live)/layout.tsx";
const LANDING = "src/app/[locale]/page.tsx";
const JUDGE_FEATURE = "src/features/judge/x.ts";
const DEMO_FEATURE = "src/features/demo/x.ts";
const NO_ROLE_CODE_FILES = [JUDGE_ROUTE, JUDGE_LIVE_ROUTE, LANDING, JUDGE_FEATURE, DEMO_FEATURE];
const SHARED = [
  "src/components/ui/button.tsx",
  "src/api/client.ts",
  "src/lib/utils.ts",
  "src/i18n/request.ts",
];
// Pages outside every group (the locale home, the dev specimen) are not restricted. Neither is the PWA feature
// (src/features/pwa: the manifest, the offline fallback and the SW cache rules hold no personal data, so it is
// neutral ground that worker, supervisor and app-level code may all use) nor the files that wire it in.
const UNRESTRICTED = [
  "src/app/[locale]/dev/specimen/page.tsx",
  "src/app/[locale]/offline/page.tsx",
  "src/app/[locale]/manifest.webmanifest/route.ts",
  "src/app/serwist/[path]/route.ts",
  "src/app/sw.ts",
  "src/features/pwa/fallback.ts",
  "src/features/pwa/manifest.ts",
  "src/features/pwa/api-cache.ts",
  "src/features/pwa/runtime-caching.ts",
];

async function rulesFor(rel: string): Promise<Rules> {
  const config = (await eslint.calculateConfigForFile(path.join(cwd, rel))) as Linter.Config | undefined;
  return config?.rules ?? {};
}

interface ImportPattern {
  group?: string[];
  regex?: string;
}

/** Severity and `patterns` of the resolved no-restricted-imports entry, or undefined when the rule is not set. */
function importPatterns(rules: Rules): { severity: unknown; patterns: ImportPattern[] } | undefined {
  const entry = rules[IMPORTS];
  if (!Array.isArray(entry)) return undefined;
  const options = entry[1] as { patterns?: ImportPattern[] } | undefined;
  return { severity: entry[0], patterns: options?.patterns ?? [] };
}

function groupsOf(rules: Rules): string[] {
  return (importPatterns(rules)?.patterns ?? []).flatMap((pattern) => pattern.group ?? []);
}

/** Rule ids reported for `code` when it is linted as the file `rel` with the rules the real config resolves for it. */
async function lintAs(rel: string, code: string): Promise<string[]> {
  const rules = await rulesFor(rel);
  const isolation: Rules = {};
  for (const id of [IMPORTS, SYNTAX]) {
    const entry = rules[id];
    if (entry !== undefined) isolation[id] = entry;
  }
  const linter = new Linter({ cwd, configType: "flat" });
  const messages = linter.verify(
    code,
    defineConfig([{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tseslint.parser }, rules: isolation }]),
    { filename: rel },
  );
  return messages.map((message) => message.ruleId ?? `parse error: ${message.message}`);
}

beforeAll(async () => {
  // The first call loads eslint.config.mjs and every plugin it names.
  await rulesFor(WORKER_ROUTE);
}, 60_000);

describe("route-group isolation: the options ESLint resolves per path", () => {
  it.each([WORKER_ROUTE, ...WORKER_FEATURES])("%s: error, no supervisor or hse imports", async (rel) => {
    const rules = await rulesFor(rel);
    expect(importPatterns(rules)?.severity).toBe(2);
    expect(groupsOf(rules)).toEqual(expect.arrayContaining(["**/features/supervisor", "**/(supervisor)", "**/(hse)"]));
    expect(rules[SYNTAX]).toBeDefined();
  });

  it.each(NO_ROLE_CODE_FILES)("%s: error, no worker, supervisor or hse imports", async (rel) => {
    const rules = await rulesFor(rel);
    expect(importPatterns(rules)?.severity).toBe(2);
    expect(groupsOf(rules)).toEqual(
      expect.arrayContaining([
        ...WORKER_FEATURE_NAMES.map((name) => `**/features/${name}`),
        "**/features/supervisor",
        "**/(worker)",
        "**/(supervisor)",
        "**/(hse)",
      ]),
    );
    expect(rules[SYNTAX]).toBeDefined();
  });

  it.each([SUPERVISOR_ROUTE, HSE_ROUTE, SUPERVISOR_FEATURE])("%s: error, no worker imports", async (rel) => {
    const rules = await rulesFor(rel);
    expect(importPatterns(rules)?.severity).toBe(2);
    expect(groupsOf(rules)).toEqual(
      expect.arrayContaining([
        "**/features/today",
        "**/features/profile",
        "**/features/risk",
        "**/features/push",
        "**/features/alert",
        "**/features/unwell",
        "**/(worker)",
      ]),
    );
    expect(rules[SYNTAX]).toBeDefined();
  });

  it.each([...WORKER_FEATURES, SUPERVISOR_FEATURE, JUDGE_FEATURE, DEMO_FEATURE])("%s: parent-relative imports are banned", async (rel) => {
    expect(groupsOf(await rulesFor(rel))).toEqual(expect.arrayContaining([".."]));
  });

  it.each(SHARED)("%s (shared code): error, no feature or route group imports", async (rel) => {
    const rules = await rulesFor(rel);
    expect(importPatterns(rules)?.severity).toBe(2);
    expect(groupsOf(rules)).toEqual(
      expect.arrayContaining(["**/features/*", "**/(worker)", "**/(supervisor)", "**/(hse)", "**/(judge)"]),
    );
    expect(rules[SYNTAX]).toBeDefined();
  });

  it.each(UNRESTRICTED)("%s: not restricted", async (rel) => {
    const rules = await rulesFor(rel);
    expect(rules[IMPORTS]).toBeUndefined();
    expect(rules[SYNTAX]).toBeUndefined();
  });
});

describe("route-group isolation: what the resolved rules report", () => {
  // [name, the file the code is linted as, the code, the rule ids it must report]; [] means it must stay clean.
  const reported: readonly (readonly [string, string, string, string[]])[] = [
    // Static imports, both directions, alias and relative spellings, type imports.
    ["worker route, alias", WORKER_ROUTE, 'import { y } from "@/features/supervisor/x"; export { y };', [IMPORTS]],
    ["worker route, supervisor group path", WORKER_ROUTE, 'export { default } from "@/app/[locale]/(supervisor)/supervisor/page";', [IMPORTS]],
    ["worker route, hse group path", WORKER_ROUTE, 'export { default } from "@/app/[locale]/(hse)/hse/page";', [IMPORTS]],
    // Reported twice: it names a supervisor feature and it is parent-relative.
    ["worker feature, relative through features", "src/features/today/x.ts", 'export { y } from "../../features/supervisor/x";', [IMPORTS, IMPORTS]],
    ["worker feature, type import", "src/features/push/x.ts", 'import type { T } from "@/features/supervisor/x"; export type U = T;', [IMPORTS]],
    ["supervisor route, alias", SUPERVISOR_ROUTE, 'export { x } from "@/features/risk/store";', [IMPORTS]],
    ["hse route, worker group path", HSE_ROUTE, 'export { default } from "@/app/[locale]/(worker)/worker/page";', [IMPORTS]],
    ["supervisor feature, type import", SUPERVISOR_FEATURE, 'import type { S } from "@/features/profile/store"; export type U = S;', [IMPORTS]],
    // A bare sibling spelling cannot be told from a legitimate one by name, so parent-relative imports are banned.
    ["supervisor feature, bare sibling", SUPERVISOR_FEATURE, 'export { x } from "../risk/store";', [IMPORTS]],
    ["worker feature, bare sibling", "src/features/risk/x.ts", 'export { y } from "../supervisor/x";', [IMPORTS]],
    ["supervisor feature, bare parent", SUPERVISOR_FEATURE, 'export * from "..";', [IMPORTS]],
    // The price of the rule: even a parent-relative import inside the same feature must use the alias.
    ["supervisor feature, parent-relative import of its own code", SUPERVISOR_FEATURE, 'export { m } from "../model";', [IMPORTS]],
    // import() and require() are invisible to no-restricted-imports.
    ["supervisor feature, import()", SUPERVISOR_FEATURE, 'export const load = () => import("@/features/risk/store");', [SYNTAX]],
    ["supervisor route, import() of a worker group path", SUPERVISOR_ROUTE, 'export const load = () => import("@/app/[locale]/(worker)/worker/page");', [SYNTAX]],
    ["worker feature, import()", "src/features/risk/x.ts", 'export const load = () => import("@/features/supervisor/x");', [SYNTAX]],
    ["worker route, import() of a supervisor group path", WORKER_ROUTE, 'export const load = () => import("@/app/[locale]/(supervisor)/supervisor/page");', [SYNTAX]],
    ["supervisor feature, require()", SUPERVISOR_FEATURE, 'export const r: unknown = require("@/features/risk/store");', [SYNTAX]],
    ["supervisor feature, import() of a bare sibling", SUPERVISOR_FEATURE, 'export const load = () => import("../risk/store");', [SYNTAX]],
    ["worker feature, require() of a bare sibling", "src/features/risk/x.ts", 'export const r: unknown = require("../supervisor/x");', [SYNTAX]],
    ["supervisor feature, import type expression", SUPERVISOR_FEATURE, 'export type T = import("@/features/risk/store").S;', [SYNTAX]],
    ["worker route, import type expression", WORKER_ROUTE, 'export type T = import("@/app/[locale]/(hse)/hse/page").S;', [SYNTAX]],
    // Shared code: a feature may use shared code but shared code must never reach back into a feature or a group.
    ["shared component, alias", "src/components/ui/button.tsx", 'export { x } from "@/features/risk/store";', [IMPORTS]],
    ["shared component, relative", "src/components/ui/button.tsx", 'export { x } from "../../features/risk/store";', [IMPORTS]],
    ["shared lib, supervisor group path", "src/lib/utils.ts", 'export { default } from "@/app/[locale]/(supervisor)/supervisor/page";', [IMPORTS]],
    ["shared api, import()", "src/api/client.ts", 'export const load = () => import("@/features/today/x");', [SYNTAX]],
    ["shared i18n, require()", "src/i18n/request.ts", 'export const r: unknown = require("@/features/profile/store");', [SYNTAX]],
    ["shared component, import type expression", "src/components/ui/button.tsx", 'export type T = import("@/features/risk/store").S;', [SYNTAX]],
    // The PWA feature is a feature like any other for shared code: shared code must not import it. That is why the
    // fallback mapping lives in src/features/pwa and is imported only by files in src/app (the SW, the layout).
    ["shared lib, pwa feature", "src/lib/utils.ts", 'export { fallbackUrlFor } from "@/features/pwa/fallback";', [IMPORTS]],
    ["shared component, pwa feature import()", "src/components/ui/button.tsx", 'export const load = () => import("@/features/pwa/fallback");', [SYNTAX]],
    // Task 3: the judge group, the landing page and the judge feature are public and static; the demo feature is neutral.
    ["test_judge_group_cannot_import_worker_code: judge route, worker feature", JUDGE_ROUTE, 'import { s } from "@/features/profile/store"; export { s };', [IMPORTS]],
    ["judge route, worker group path", JUDGE_ROUTE, 'export { default } from "@/app/[locale]/(worker)/worker/page";', [IMPORTS]],
    ["judge route, supervisor feature", JUDGE_ROUTE, 'import { s } from "@/features/supervisor/x"; export { s };', [IMPORTS]],
    ["judge route, hse group path", JUDGE_ROUTE, 'export { default } from "@/app/[locale]/(hse)/hse/page";', [IMPORTS]],
    ["judge route, the new worker features", JUDGE_ROUTE, 'import { a } from "@/features/alert/x"; import { u } from "@/features/unwell/x"; export { a, u };', [IMPORTS, IMPORTS]],
    ["judge route, import()", JUDGE_ROUTE, 'export const load = () => import("@/features/today/useSiteToday");', [SYNTAX]],
    ["judge live route, worker feature", JUDGE_LIVE_ROUTE, 'import { s } from "@/features/risk/personal"; export { s };', [IMPORTS]],
    ["test_landing_page_cannot_import_worker_code: landing page, worker feature", LANDING, 'import { s } from "@/features/profile/store"; export { s };', [IMPORTS]],
    ["landing page, supervisor group path", LANDING, 'export { default } from "@/app/[locale]/(supervisor)/supervisor/page";', [IMPORTS]],
    ["landing page, require()", LANDING, 'export const r: unknown = require("@/features/push/usePush");', [SYNTAX]],
    ["judge feature, worker feature", JUDGE_FEATURE, 'import { s } from "@/features/profile/store"; export { s };', [IMPORTS]],
    ["judge feature, bare sibling", JUDGE_FEATURE, 'export { x } from "../today/x";', [IMPORTS]],
    ["demo feature, worker feature", DEMO_FEATURE, 'import { s } from "@/features/profile/store"; export { s };', [IMPORTS]],
    ["demo feature, supervisor feature", DEMO_FEATURE, 'import { s } from "@/features/supervisor/x"; export { s };', [IMPORTS]],
    ["shared component, judge group path", "src/components/ui/button.tsx", 'export { default } from "@/app/[locale]/(judge)/replay/layout";', [IMPORTS]],
    ["worker feature, the new alert feature is a worker feature (a supervisor feature may not import it)", SUPERVISOR_FEATURE, 'import { a } from "@/features/alert/x"; export { a };', [IMPORTS]],
    ["supervisor route, the new unwell feature", SUPERVISOR_ROUTE, 'import { u } from "@/features/unwell/x"; export { u };', [IMPORTS]],
    // F2 Part 0 (I2): field surfaces link through FieldLink, never the raw locale Link or next/link (no prefetch on a field page).
    ["test_field_routes_cannot_import_the_raw_link: worker route, locale Link", WORKER_ROUTE, 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    ["worker route, next/link", WORKER_ROUTE, 'import L from "next/link"; export { L };', [IMPORTS]],
    ["worker route, a renamed locale Link", WORKER_ROUTE, 'import { Link as L } from "@/i18n/navigation"; export { L };', [IMPORTS]],
    ["supervisor route, locale Link", SUPERVISOR_ROUTE, 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    ["worker feature, locale Link", "src/features/today/x.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    ["supervisor feature, next/link", SUPERVISOR_FEATURE, 'import L from "next/link"; export { L };', [IMPORTS]],
    ["field shell, locale Link", "src/components/shell/FieldShell.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    ["worker dock, locale Link", "src/components/shell/WorkerDock.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    ["empty state, locale Link", "src/components/states/EmptyState.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    // F2 W1: the proof drawer ships on worker routes (through ProofChip) and links like a field page; a RELATIVE path to the
    // navigation module is the same module and the same ban.
    ["test_proof_drawer_cannot_import_the_raw_link: proof drawer, locale Link", "src/components/provenance/ProofDrawer.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', [IMPORTS]],
    ["worker route, a relative path to the navigation module", WORKER_ROUTE, 'import { Link } from "../../../../../i18n/navigation"; export { Link };', [IMPORTS]],
    ["supervisor route, a relative path to the navigation module", SUPERVISOR_ROUTE, 'import { Link } from "../../../i18n/navigation"; export { Link };', [IMPORTS]],
    // The shared-code rule still holds for those files (the field-link block repeats it: its options replace the shared block's).
    ["field shell, a feature import is still banned", "src/components/shell/FieldShell.tsx", 'import { s } from "@/features/risk/store"; export { s };', [IMPORTS]],
    ["empty state, a route group import is still banned", "src/components/states/EmptyState.tsx", 'export { default } from "@/app/[locale]/(worker)/worker/page";', [IMPORTS]],
    ["empty state, import() of a feature is still banned", "src/components/states/EmptyState.tsx", 'export const load = () => import("@/features/risk/store");', [SYNTAX]],
    // What must stay allowed.
    ["worker route, FieldLink and the other exports of the navigation module", WORKER_ROUTE, 'import { FieldLink } from "@/components/shell/FieldLink"; import { usePathname, getPathname } from "@/i18n/navigation"; export { FieldLink, usePathname, getPathname };', []],
    ["worker route, a relative path to the navigation module is fine for what is not Link", WORKER_ROUTE, 'import { useRouter } from "../../../../../i18n/navigation"; export { useRouter };', []],
    ["FieldLink itself is the one file that imports the raw Link", "src/components/shell/FieldLink.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', []],
    ["desk shell keeps the locale Link", "src/components/shell/DeskShell.tsx", 'import { Link } from "@/i18n/navigation"; export { Link };', []],
    ["hse route keeps the locale Link", HSE_ROUTE, 'import { Link } from "@/i18n/navigation"; export { Link };', []],
    ["judge route keeps the locale Link", JUDGE_ROUTE, 'import { Link } from "@/i18n/navigation"; export { Link };', []],
    ["judge feature keeps the locale Link", JUDGE_FEATURE, 'import { Link } from "@/i18n/navigation"; export { Link };', []],
    ["landing page, shared code and the neutral features", LANDING, 'import { Link } from "@/i18n/navigation"; import { d } from "@/features/demo/constants"; import { p } from "@/features/pwa/manifest"; import { j } from "@/features/judge/x"; export { Link, d, p, j };', []],
    ["judge route, shared code, the demo feature and its own feature", JUDGE_ROUTE, 'import { s } from "@/components/shell/DeskShell"; import { d } from "@/features/demo/DemoProvider"; import { j } from "@/features/judge/x"; export { s, d, j };', []],
    ["worker route, the demo feature (neutral)", WORKER_ROUTE, 'import { d } from "@/features/demo/DemoProvider"; export { d };', []],
    ["supervisor route, the demo feature (neutral)", SUPERVISOR_ROUTE, 'import { d } from "@/features/demo/DemoProvider"; export { d };', []],
    ["supervisor feature, own code and shared code", SUPERVISOR_FEATURE, 'import { a } from "./local"; import { b } from "@/api/client"; import { c } from "@/components/ui/button"; import { d } from "@/features/supervisor/model"; export { a, b, c, d };', []],
    ["supervisor feature, import() of own and shared code", SUPERVISOR_FEATURE, 'export const load = () => [import("./local"), import("@/features/supervisor/model"), import("@/lib/utils")]; export type T = import("@/features/supervisor/model").M;', []],
    ["route files may use parent-relative imports (only feature code may not)", WORKER_ROUTE, 'export { a } from "../local"; export const load = () => import("../lazy");', []],
    ["worker feature, own code and shared code", "src/features/risk/x.ts", 'import { a } from "./local"; import { s } from "@/lib/utils"; import { r } from "@/features/risk/store"; export { a, s, r };', []],
    ["worker feature, import() of own code", "src/features/risk/x.ts", 'export const load = () => import("@/features/risk/lazy");', []],
    ["worker feature, a name that only starts like supervisor", "src/features/risk/x.ts", 'import { a } from "@/features/supervisorish/x"; export const load = () => import("@/features/supervisorish/x"); export { a };', []],
    ["worker route, worker features", WORKER_ROUTE, 'import { a } from "@/features/today/x"; import { b } from "@/features/risk/x"; export const load = () => import("@/features/profile/x"); export { a, b };', []],
    ["supervisor route, supervisor features", SUPERVISOR_ROUTE, 'import { a } from "@/features/supervisor/x"; export const load = () => import("@/features/supervisor/x"); export { a };', []],
    ["hse route, supervisor features (a preview of the supervisor view)", HSE_ROUTE, 'import { a } from "@/features/supervisor/x"; export { a };', []],
    // The PWA feature is neutral: the service worker, the layout, the worker route and the supervisor route may use it.
    ["service worker, pwa feature", "src/app/sw.ts", 'import { offlineFallbacks } from "@/features/pwa/fallback"; import { isCachedApiPath } from "@/features/pwa/api-cache"; export { offlineFallbacks, isCachedApiPath };', []],
    ["worker route, pwa feature", WORKER_ROUTE, 'import { fallbackUrlFor } from "@/features/pwa/fallback"; export { fallbackUrlFor };', []],
    ["supervisor route, pwa feature", SUPERVISOR_ROUTE, 'import { fallbackUrlFor } from "@/features/pwa/fallback"; export { fallbackUrlFor };', []],
    // Task 8's profile store (a worker feature) calls clearApiCaches when a worker revokes consent or changes profile.
    ["worker feature, pwa feature (clearApiCaches)", "src/features/profile/x.ts", 'import { clearApiCaches } from "@/features/pwa/api-cache"; export { clearApiCaches };', []],
    ["pwa feature, shared code", "src/features/pwa/fallback.ts", 'import { routing } from "@/i18n/routing"; import { u } from "@/lib/utils"; export { routing, u };', []],
    ["shared code, shared code", "src/components/ui/button.tsx", 'import { cn } from "./utils"; import { u } from "@/lib/utils"; export const load = () => import("@/i18n/routing"); export { cn, u };', []],
  ];

  it.each(reported)("%s", async (_name, rel, code, expected) => {
    expect(await lintAs(rel, code)).toEqual(expected);
  });
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

// Route-group isolation (ADR 0009 section 7). Worker code holds on-device personal data (profile, risk), so
// supervisor and HSE code must not be able to import it, and the worker group must not pull in supervisor or
// HSE code either. Shared code (src/components, src/api, src/lib, src/i18n, src/styles) sits below both:
// features and route groups may use it, and it must never import a feature or a route group, or supervisor
// code would reach the worker side through it.
//
// Every way of naming an import is covered with core rules only (no new dependency):
//  - static import and export-from, `import type` included: no-restricted-imports with gitignore-style patterns.
//    The rule matches the import string, not the resolved file, so `**/features/supervisor` catches
//    "@/features/supervisor/x" and "../../features/supervisor/x" alike.
//  - dynamic import(), require() and `import("...")` types, which no-restricted-imports does not see:
//    no-restricted-syntax selectors with the same targets, as one regex. An esquery regex literal ends at the first
//    "/", so a path separator is written as "any character that cannot be part of a name".
//  - a bare sibling ("../supervisor/x" from inside src/features/risk) cannot be told from a legitimate import by
//    its name, so feature code may not use parent-relative imports at all: reach another directory through "@/".
//    Not covered: an import whose path is built at run time (a template literal).
//
// `[locale]` is written `[[]locale]` in `files`: the globs are minimatch, where a bare [locale] is a character
// class (it would match the directory "l"), and `[[]` is the class that holds only a literal "[".
//
// Options of these two rules replace, never merge, across config objects that match the same file, so the blocks
// below cover disjoint files and a later block must not set either rule for them. The one deliberate overlap is the last
// block (field shell, dock, state components), which repeats the shared-code rule of the block before it and adds the ban on
// the raw links, because the later block wins whole.
// tests/unit/lint/route-group-isolation.test.ts resolves the real config per path and fails if one did.
const WORKER_FEATURES = ["today", "profile", "risk", "push", "alert", "unwell"];
const SHARED_DIRS = ["components", "api", "lib", "i18n"];

// One forbidden target, written for both mechanisms: `globs` (gitignore syntax) for no-restricted-imports and
// `re` (regex source) for the selectors. A name character is a letter, digit, "_" or "-".
const NOT_NAME = String.raw`[^\w-]`;
const featureDir = (name) => ({
  globs: [`**/features/${name}`],
  re: `(^|${NOT_NAME})features${NOT_NAME}${name}(${NOT_NAME}|$)`,
});
const routeGroup = (name) => ({ globs: [`**/(${name})`], re: `[(]${name}[)]` });
const ANY_FEATURE = { globs: ["@/features", "**/features/*"], re: `(^|${NOT_NAME})features(${NOT_NAME}|$)` };
const PARENT_RELATIVE = { globs: [".."], re: String.raw`(^|[^.\w-])[.][.]([^.\w-]|$)` };

const SHARED_HOME = "Shared code lives in src/components, src/api, src/lib, src/i18n and src/styles.";
const NO_SUPERVISOR_CODE = `Worker code must not import supervisor or HSE code (ADR 0009 section 7). ${SHARED_HOME}`;
const NO_WORKER_CODE = `Supervisor and HSE code must not import worker code: on-device personal data stays unreachable from it (ADR 0009 section 7). ${SHARED_HOME}`;
const NO_ROLE_CODE = `The judge pages, the landing page and the shared demo feature must not import worker, supervisor or HSE code (ADR 0009 section 7, F2 Task 3): they are public and static, and must not be able to reach on-device personal data. ${SHARED_HOME}`;
const NO_FEATURE_CODE = `Shared code must not import a feature or a route group (ADR 0009 section 7): features use shared code, never the reverse.`;
const NO_PARENT_RELATIVE = `Feature code reaches other directories through the "@/" alias, not "../": the isolation rule matches import paths by name (ADR 0009 section 7).`;
const NO_RAW_LINK = `Field surfaces use FieldLink (src/components/shell/FieldLink.tsx), not the raw locale Link or next/link: a prefetch writes the service worker's prefetch cache and ships the target route's script, which a field page must never do (F2 Part 0, F1 invariant b).`;

// The raw links, for `no-restricted-imports` `paths`: the locale-aware `Link` of next-intl and `next/link` itself. Only
// FieldLink.tsx (and the desk and judge surfaces, which are not field surfaces) may import them.
const RAW_LINK_PATHS = [
  { name: "@/i18n/navigation", importNames: ["Link"], message: NO_RAW_LINK },
  { name: "next/link", message: NO_RAW_LINK },
];
// The same module reached by a RELATIVE path (`../../i18n/navigation`, `./navigation` from inside src/i18n): `paths` matches the
// exact specifier only, so a route file could have dodged the ban by spelling the path another way (F2 W1). The alias form is
// left to `paths`, so an import is reported once.
const RAW_LINK_PATTERNS = [{ regex: String.raw`^[.]{1,2}/(.*/)?navigation(\.[jt]sx?)?$`, importNames: ["Link"], message: NO_RAW_LINK }];

/**
 * A config object that applies no-restricted-imports and no-restricted-syntax to `files`; one `forbid` entry per message.
 * `fieldLinks` adds the ban on the raw links (RAW_LINK_PATHS) for the files of a field surface: it is a `paths` entry of the
 * same rule because the options of a rule replace, never merge (see above), so it cannot be a block of its own.
 */
function isolation(files, forbid, { fieldLinks = false } = {}) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          ...(fieldLinks ? { paths: RAW_LINK_PATHS } : {}),
          patterns: [
            ...forbid.map(({ targets, message }) => ({ group: targets.flatMap((t) => t.globs), message })),
            ...(fieldLinks ? RAW_LINK_PATTERNS : []),
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...forbid.flatMap(({ targets, message }) => {
          const regex = targets.map((t) => t.re).join("|");
          return [
            { selector: `ImportExpression[source.value=/${regex}/]`, message },
            { selector: `CallExpression[callee.name='require'][arguments.0.value=/${regex}/]`, message },
            { selector: `TSImportType[argument.literal.value=/${regex}/]`, message },
          ];
        }),
      ],
    },
  };
}

const forbidSupervisorCode = { targets: [featureDir("supervisor"), routeGroup("supervisor"), routeGroup("hse")], message: NO_SUPERVISOR_CODE };
const forbidWorkerCode = { targets: [...WORKER_FEATURES.map(featureDir), routeGroup("worker")], message: NO_WORKER_CODE };
// The judge route group (src/app/[locale]/(judge)), its feature (src/features/judge), the locale landing page and the
// demo feature (src/features/demo, neutral ground that worker, supervisor and judge code all use) may not import any
// role's code. Judge code is not forbidden from `features/demo`, and `features/demo` is not forbidden from
// importing the judge feature: only the three role groups are walled off.
const forbidRoleCode = {
  targets: [
    ...WORKER_FEATURES.map(featureDir),
    featureDir("supervisor"),
    routeGroup("worker"),
    routeGroup("supervisor"),
    routeGroup("hse"),
  ],
  message: NO_ROLE_CODE,
};
const forbidParentRelative = { targets: [PARENT_RELATIVE], message: NO_PARENT_RELATIVE };

const forbidFeatureCode = {
  targets: [ANY_FEATURE, routeGroup("worker"), routeGroup("supervisor"), routeGroup("hse"), routeGroup("judge")],
  message: NO_FEATURE_CODE,
};

// The field surfaces (`fieldLinks: true`): the worker and supervisor route groups and their features, the field shell and
// the dock, and the state components (the empty and error states link from field pages as well as judge pages). The HSE
// group, the judge group, the landing page and the desk shell are desk surfaces and keep the raw Link.
const routeGroupIsolation = [
  isolation(["src/app/[[]locale]/(worker)/**"], [forbidSupervisorCode], { fieldLinks: true }),
  isolation(
    WORKER_FEATURES.map((name) => `src/features/${name}/**`),
    [forbidSupervisorCode, forbidParentRelative],
    { fieldLinks: true },
  ),
  isolation(["src/app/[[]locale]/(supervisor)/**"], [forbidWorkerCode], { fieldLinks: true }),
  isolation(["src/app/[[]locale]/(hse)/**"], [forbidWorkerCode]),
  isolation(["src/features/supervisor/**"], [forbidWorkerCode, forbidParentRelative], { fieldLinks: true }),
  // The judge pages are measured against the route JS budget, and a prefetching link ships its target page's script
  // (F2 Part G1: the desk header alone cost 16 KB on /replay/governance), so the judge group and feature use FieldLink too.
  isolation(["src/app/[[]locale]/(judge)/**"], [forbidRoleCode], { fieldLinks: true }),
  isolation(["src/app/[[]locale]/page.tsx"], [forbidRoleCode]),
  isolation(["src/features/judge/**"], [forbidRoleCode, forbidParentRelative], { fieldLinks: true }),
  isolation(["src/features/demo/**"], [forbidRoleCode, forbidParentRelative]),
  isolation(
    SHARED_DIRS.map((name) => `src/${name}/**`),
    [forbidFeatureCode],
  ),
  // Later than the shared block above, which matches the same files: the options replace, so this block repeats the shared
  // rule and adds the raw-link ban. FieldLink.tsx is not listed: it is the one file that imports the raw Link.
  isolation(
    [
      "src/components/shell/FieldShell.tsx",
      "src/components/shell/WorkerDock.tsx",
      "src/components/states/**",
      // Ships on every worker route through ProofChip (a dynamic import, but one tap away): its link is a field link too.
      "src/components/provenance/ProofDrawer.tsx",
    ],
    [forbidFeatureCode],
    { fieldLinks: true },
  ),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // eslint-config-next already registers the jsx-a11y plugin; only the strict rule set is added here.
    files: ["**/*.{jsx,tsx}"],
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      // The shadcn <Label> is a label too: call sites must connect it to a control (htmlFor or nesting).
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          labelComponents: ["Label"],
          controlComponents: ["SelectTrigger", "Switch", "RadioGroupItem"],
          assert: "either",
          depth: 3,
        },
      ],
    },
  },
  {
    // The generated <Label> only forwards props: htmlFor and the control arrive from the call site, which is checked above.
    files: ["src/components/ui/label.tsx"],
    rules: { "jsx-a11y/label-has-associated-control": "off" },
  },
  ...routeGroupIsolation,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

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
// below cover disjoint files and a later block must not set either rule for them.
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

/** A config object that applies no-restricted-imports and no-restricted-syntax to `files`; one `forbid` entry per message. */
function isolation(files, forbid) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: forbid.map(({ targets, message }) => ({ group: targets.flatMap((t) => t.globs), message })) },
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

const routeGroupIsolation = [
  isolation(["src/app/[[]locale]/(worker)/**"], [forbidSupervisorCode]),
  isolation(
    WORKER_FEATURES.map((name) => `src/features/${name}/**`),
    [forbidSupervisorCode, forbidParentRelative],
  ),
  isolation(["src/app/[[]locale]/(supervisor)/**", "src/app/[[]locale]/(hse)/**"], [forbidWorkerCode]),
  isolation(["src/features/supervisor/**"], [forbidWorkerCode, forbidParentRelative]),
  isolation(["src/app/[[]locale]/(judge)/**", "src/app/[[]locale]/page.tsx"], [forbidRoleCode]),
  isolation(["src/features/judge/**", "src/features/demo/**"], [forbidRoleCode, forbidParentRelative]),
  isolation(
    SHARED_DIRS.map((name) => `src/${name}/**`),
    [
      {
        targets: [ANY_FEATURE, routeGroup("worker"), routeGroup("supervisor"), routeGroup("hse"), routeGroup("judge")],
        message: NO_FEATURE_CODE,
      },
    ],
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

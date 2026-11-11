import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

// Route-group isolation (ADR 0009 section 7). Worker code holds on-device personal data (profile, risk), so
// supervisor and HSE code must not be able to import it, and the worker group must not pull in supervisor
// or HSE code either. Shared code lives in src/components, src/api, src/i18n and src/styles.
//
// The rule matches the import string, not the resolved file. Each pattern is gitignore-style, so
// `**/features/supervisor` catches the alias form ("@/features/supervisor/x") and relative forms
// ("../../features/supervisor/x"). It does not catch a bare sibling spelling ("../supervisor/x" from inside
// src/features/risk), nor dynamic import() or require(): keep cross-feature imports on the "@/" alias.
//
// `[locale]` is written `[[]locale]` in `files`: the globs are minimatch, where a bare [locale] is a character
// class (it would match the directory "l"), and `[[]` is the class that holds only a literal "[".
//
// no-restricted-imports options replace, never merge, across config objects that match the same file. The two
// blocks below cover disjoint files on purpose; a later block must not set this rule for these directories.
const WORKER_FEATURES = ["today", "profile", "risk", "push"];

const workerSideIsolation = {
  files: ["src/app/[[]locale]/(worker)/**", ...WORKER_FEATURES.map((feature) => `src/features/${feature}/**`)],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/features/supervisor", "**/(supervisor)", "**/(hse)"],
            message:
              "Worker code must not import supervisor or HSE code (ADR 0009 section 7). Put shared code in src/components, src/api, src/i18n or src/styles.",
          },
        ],
      },
    ],
  },
};

const supervisorSideIsolation = {
  files: ["src/app/[[]locale]/(supervisor)/**", "src/app/[[]locale]/(hse)/**", "src/features/supervisor/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: [...WORKER_FEATURES.map((feature) => `**/features/${feature}`), "**/(worker)"],
            message:
              "Supervisor and HSE code must not import worker code: on-device personal data stays unreachable from it (ADR 0009 section 7). Put shared code in src/components, src/api, src/i18n or src/styles.",
          },
        ],
      },
    ],
  },
};

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
  workerSideIsolation,
  supervisorSideIsolation,
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

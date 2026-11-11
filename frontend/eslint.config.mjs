import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

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

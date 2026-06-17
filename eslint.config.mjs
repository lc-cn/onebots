import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/lib/**",
      "**/dist/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      // Warn on explicit any (Phase 2 gradually eliminated these)
      "@typescript-eslint/no-explicit-any": "warn",
      // Warn on console usage (should use @onebots/core Logger instead)
      "no-console": "warn",
      // Warn on unused variables
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Error on require() - should use ESM imports
      "@typescript-eslint/no-var-requires": "error",
      // Warn on empty functions
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];

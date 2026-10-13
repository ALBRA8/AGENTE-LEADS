// ============================================================
// eslint.config.mjs — Flat config for ESLint 9 (dashboard)
// Minimal, operational: typescript-eslint recommended, no
// style/formatting rules (those belong to prettier, not lint CI).
// Config files, build output and Next generated files are ignored.
// ============================================================
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // --- Global ignores (never lint) ---
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      "next.config.ts",
      "**/*.config.*", // next.config.ts, postcss.config.mjs, vitest.config.ts, eslint.config.mjs, ...
      "public/**",
    ],
  },

  // --- TypeScript sources: parser + recommended rules ---
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["node_modules/**", ".next/**"],
  })),

  // --- react-hooks plugin registration (definitions only) ---
  // Pre-existing files carry inline `eslint-disable-next-line react-hooks/...`
  // directives; without the plugin registered ESLint errors with
  // "Definition for rule ... was not found". Rules stay OFF (minimal config),
  // this only makes the inline directives resolvable.
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
  },

  // --- Operational tuning: pre-existing codebase noise → warnings (non-blocking) ---
  // Kept as warnings so `npm run lint` stays exit 0 while still surfacing the smell.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
    },
  }
);

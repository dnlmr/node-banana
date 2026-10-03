// `npm run lint`. Next.js's rules plus TypeScript's, with three deliberate
// softenings so the check passes and stays meaningful:
//  - CommonJS files (the Electron shell, scripts, server.js) may `require`.
//  - The React Compiler rules (set-state-in-effect, refs, memoization…) and
//    `no-explicit-any` are warnings: they describe debt in code that works,
//    and a new error among them would be lost in the noise if they failed
//    the run. `npm run typecheck` is the hard gate for types.
//  - The vendored AI Elements chat kit is not ours to rewrite.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next's configs register their plugins only for the files they match; the
// softenings below mention those plugins' rules for every file, so the same
// plugin objects are registered here too.
const plugin = (name) => [...nextVitals, ...nextTs].find((config) => config.plugins?.[name])?.plugins[name];

export default [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", ".next-electron/**", "dist-electron/**", "out/**", "site/**", "node_modules/**", ".scratch/**", "public/**", "coverage/**"],
  },
  {
    plugins: { "react-hooks": plugin("react-hooks"), "jsx-a11y": plugin("jsx-a11y"), "@typescript-eslint": plugin("@typescript-eslint") },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/static-components": "warn",
      // Only DOM images: lucide's `Image` icon is not a picture.
      "jsx-a11y/alt-text": ["error", { elements: ["img", "object", "area", "input[type=\"image\"]"] }],
    },
  },
  {
    // CommonJS by design; tests that `require` a module after mocking it.
    files: ["**/*.cjs", "**/*.js", "**/__tests__/**"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

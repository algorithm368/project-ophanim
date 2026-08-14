import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Nested build output (e.g. scratch git worktrees under .claude/worktrees/).
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma-generated client (not hand-written source).
    "lib/generated/**",
    // design-sync scratch: vendored bundle and generated sync scripts. All
    // gitignored, so CI never sees them; without these, a local `bun run lint`
    // fails on files that are not this project's source.
    "ds-bundle/**",
    ".ds-sync/**",
    ".design-sync/.cache/**",
    ".design-sync/node_modules/**",
    // Coverage report output.
    "coverage/**",
  ]),
]);

export default eslintConfig;

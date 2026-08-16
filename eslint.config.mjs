import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Two of the rules SonarCloud enforces, run locally.
  //
  // These are the same rule implementations the server uses, so the numbers
  // match exactly, and they are the two that actually accumulate here: between
  // them S3776 and S3358 were 63 of the 94 issues in the backlog cleared in
  // #25. Catching them in `bun run lint` is the difference between a review
  // comment and a surprise in the `sonar` job after merge.
  //
  // Errors, not warnings. A warning for "this function is too complex" is a
  // warning nobody reads, which is how it got to 24 of them.
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    plugins: { sonarjs },
    rules: {
      // Sonar S3776. 15 is Sonar's own default and the threshold the server
      // reports against; changing it here would only hide what CI still flags.
      "sonarjs/cognitive-complexity": ["error", 15],
      // Sonar S3358. Narrower than Sonar's version, which also counts a ternary
      // nested inside a template literal that is itself a ternary branch, so a
      // clean run here is necessary but not sufficient.
      "no-nested-ternary": "error",
    },
  },
  {
    // Tests read as tables of cases, and a nested ternary building an expected
    // value is clearer inline than hoisted into a helper nobody else calls.
    // Sonar does not flag these either.
    files: ["**/*.test.{ts,tsx}"],
    rules: { "no-nested-ternary": "off" },
  },
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

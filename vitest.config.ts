import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Mirror the tsconfig "@/*" -> "./*" path alias so tests import the same way
  // the app does. Scoped packages (@upstash/*, @vitest/*) are left untouched.
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // lcov is what sonar-project.properties points at; text keeps the number
      // visible in the terminal without opening a report.
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Scoped to lib/ on purpose. That is where the tests live and where the
      // logic is; app/ and components/ are wiring and JSX, and including them
      // would blend a real number with a meaningless one.
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
    },
  },
});

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
  },
});

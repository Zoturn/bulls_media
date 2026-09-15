import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Last, so it wins: turns off every stylistic rule Prettier already decides. Formatting is a
  // hook's job (.claude/hooks/format.sh), not a lint error someone has to read past.
  prettier,
  {
    rules: {
      // The agent's contracts are Zod schemas and generated Prisma types. An `any` anywhere in
      // that chain silently drops the validation this project's guarantees rest on.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "src/generated/**",
  ]),
]);

export default eslintConfig;

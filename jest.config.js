/**
 * Jest covers pure logic: the tools and their deterministic engines, the guardrails, and the
 * orchestrator driven by a mock model. Anything crossing an HTTP or browser boundary is a Cypress
 * spec instead.
 *
 * Plain .js rather than .ts: a TypeScript config file would require ts-node purely to read it.
 */

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/prisma'],
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // Migrates the shared test-database template exactly once for the whole run, before any
  // worker starts — see src/lib/testing/testDb.ts for why a per-worker guard isn't enough.
  globalSetup: '<rootDir>/jest.globalSetup.ts',
  globalTeardown: '<rootDir>/jest.globalTeardown.ts',
  testMatch: ['**/?(*.)+(spec).[jt]s?(x)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    // Matches .js too, not just .ts(x): the AI SDK and MiniSearch ship ESM-only, and this is what
    // lets ts-jest (with allowJs) convert their .js files to CommonJS instead of Jest trying to
    // require() them directly and failing.
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowJs: true,
        },
      },
    ],
  },
  // node_modules is ignored by default; carve out the ESM-only packages so the transform above
  // actually reaches them. `@workflow/serde` is `ai`'s own transitive dependency (via
  // @ai-sdk/gateway) — found the hard way when a tool test first imported `ai` and Jest refused
  // to require() its ESM syntax; MiniSearch and the rest of the chain do publish a CommonJS
  // `require` condition, so only these two need the carve-out.
  transformIgnorePatterns: ['node_modules/(?!(ai|@ai-sdk|@workflow)/)'],
  clearMocks: true,
  collectCoverageFrom: ['src/lib/**/*.ts', '!src/lib/**/*.spec.ts'],
};

module.exports = config;

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
  // actually reaches them. Only `ai` and `@ai-sdk/*` need it — MiniSearch and the SDK's other
  // transitive dependencies still publish a CommonJS `require` condition, so adding them here
  // would cost transform time for nothing.
  transformIgnorePatterns: ['node_modules/(?!(ai|@ai-sdk)/)'],
  clearMocks: true,
  collectCoverageFrom: ['src/lib/**/*.ts', '!src/lib/**/*.spec.ts'],
};

module.exports = config;

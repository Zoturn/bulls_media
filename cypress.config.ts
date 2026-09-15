import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    fixturesFolder: 'cypress/fixtures',
    video: false,
    viewportWidth: 1280,
    viewportHeight: 800,
    // The suite asserts against the deterministic seed, so it must run after `npm run db:reset`.
    retries: { runMode: 1, openMode: 0 },
    // Turbopack (npm run dev) compiles each route on first hit, and an agent run is a multi-step
    // workflow rather than a single request. These timeouts cover dev-server compile latency and
    // the run itself; they are not a licence for a slow app.
    defaultCommandTimeout: 10000,
    pageLoadTimeout: 30000,
    responseTimeout: 30000,
  },
});

import { defineConfig } from 'cypress';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { clearSeededReferenceData, seedDatabase } from './prisma/seed-lib';

loadEnv();

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
    setupNodeEvents(on) {
      // `reseed` clears and reseeds InboundMessage/RateCardPackage/PolicyRule directly through
      // Prisma — not by shelling out to `prisma migrate reset` — and returns the resulting rows
      // so a spec can compare two reseeds for the "seeding twice is deterministic" guarantee
      // without needing an HTTP endpoint that exposes them (none exists yet in this change).
      const prisma = new PrismaClient();

      on('task', {
        async reseed() {
          await clearSeededReferenceData(prisma);
          await seedDatabase(prisma);

          // Explicit `select` per .claude/rules/data-model.md rule 8, listing every column that
          // exists today — not `{ id: true }`, since the determinism spec compares whole rows
          // across two reseeds and a narrower select would silently stop checking most of it. A
          // column added later must be added here deliberately, rather than leaking into this
          // snapshot (and the spec's assertions) by default.
          const [messages, rates, policies] = await Promise.all([
            prisma.inboundMessage.findMany({
              orderBy: { id: 'asc' },
              select: {
                id: true,
                fromAddress: true,
                fromName: true,
                subject: true,
                body: true,
                receivedAt: true,
              },
            }),
            prisma.rateCardPackage.findMany({
              orderBy: { id: 'asc' },
              select: {
                id: true,
                name: true,
                channel: true,
                format: true,
                unitPriceCents: true,
                pricingUnit: true,
                availableVolume: true,
                minFlightDays: true,
                maxFlightDays: true,
                createdAt: true,
              },
            }),
            prisma.policyRule.findMany({
              orderBy: { id: 'asc' },
              select: {
                id: true,
                vertical: true,
                decision: true,
                description: true,
                createdAt: true,
              },
            }),
          ]);

          return JSON.parse(JSON.stringify({ messages, rates, policies }));
        },
      });

      on('after:run', async () => {
        await prisma.$disconnect();
      });
    },
  },
});

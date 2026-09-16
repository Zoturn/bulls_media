import { defineConfig } from 'cypress';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { clearSeededReferenceData, seedDatabase } from './prisma/seed-lib';
import { saveAssessment } from './src/lib/services/cases';
import { recordApproval } from './src/lib/services/approvals';
import type { AssessmentDisposition, ApprovalDecision } from './src/lib/domain/enums';

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

        /**
         * Writes a `Run` (and optionally its `Assessment`/`Approval`) directly through Prisma,
         * bypassing the agent entirely. The console's HTTP contract for *starting* a run and for
         * *reading* one are both real things this suite tests over real HTTP; what a real model
         * would have written into that run is not — this is the same reasoning
         * `add-agent-orchestrator` and `add-agent-guardrails` give for driving every one of their
         * own tests with a mock model, applied at the HTTP boundary instead of the loop's own.
         */
        async createFixtureRun(input: {
          caseId: string;
          status: 'RUNNING' | 'COMPLETED' | 'REFUSED' | 'NEEDS_HUMAN' | 'FAILED';
          assessment?: {
            disposition: AssessmentDisposition;
            summary: string;
            structured?: string;
            refusalReason?: string;
            quoteCents?: number;
            draftReply?: string;
          };
          approval?: { decision: ApprovalDecision; decidedBy: string; note?: string };
        }) {
          // Real, current timestamps — not a fixed literal — because a case can carry more than
          // one run (a spec that reuses a seeded message across two `it`s creates exactly that),
          // and `getCaseDetailRow` picks "the latest" by `startedAt`. A shared literal timestamp
          // makes two fixture runs on the same case indistinguishable to that ordering, which is
          // a real determinism spec's job to pin but is not this suite's concern: an operator
          // console test cares that the run it just created is the one it reads back, not that
          // the clock stood still while it did.
          const run = await prisma.run.create({
            data: {
              caseId: input.caseId,
              status: input.status,
              modelId: 'fixture-model',
              promptVersion: 'v1',
              maxSteps: 12,
              startedAt: new Date(),
              finishedAt: input.status === 'RUNNING' ? null : new Date(),
            },
            select: { id: true },
          });

          // Writing through the real services, not a raw `prisma.assessment.create`/
          // `prisma.approval.create`, so a fixture can never produce a row the app itself
          // couldn't: `saveAssessment` is what enforces "a refused case carries no quote", and
          // `recordApproval` is what resolves the case in the same transaction as the decision —
          // a hand-rolled write here would silently skip both.
          if (input.assessment) {
            const result = await saveAssessment(
              { runId: run.id, structured: '{}', ...input.assessment },
              prisma,
            );
            if (!result.ok) {
              throw new Error(`createFixtureRun: saveAssessment failed (${result.reason})`);
            }
          }

          if (input.approval) {
            const result = await recordApproval({ runId: run.id, ...input.approval }, prisma);
            if (!result.ok)
              throw new Error(`createFixtureRun: recordApproval failed (${result.reason})`);
          }

          return { runId: run.id };
        },

        /**
         * Deletes a case this suite opened, cascading its runs, assessment and approval —
         * `console.cy.ts` opens cases against seeded messages, and `clearSeededReferenceData`
         * (used by `reseed` above) cannot delete an `InboundMessage` a `Case` still references
         * (that relation is deliberately `restrict`, not cascade — see `seed-lib.ts`). This is
         * the cleanup its own doc comment names as "a decision for whichever change reaches this
         * point": `console.cy.ts` cleans up the cases it opens, in an `after` hook, so the two
         * specs stay independent of run order without weakening that relation.
         */
        async deleteFixtureCase(caseId: string) {
          await prisma.case.deleteMany({ where: { id: caseId } });
          return null;
        },
      });

      on('after:run', async () => {
        await prisma.$disconnect();
      });
    },
  },
});

import type { PrismaClient } from '@prisma/client';

/**
 * The fixture-creation steps every service- and tool-level integration test repeats. One
 * implementation here rather than six-plus near-identical copies across spec files, so a change
 * to the convention (or a new required field on `Run`) is one edit, not a hunt through every test
 * file that creates one.
 *
 * Seeding is not reimplemented here: `prisma/seed-lib.ts` is the single definition of what the
 * seed means, shared by the Prisma CLI entry point, the Cypress `reseed` task and these tests. A
 * test that wants only part of the corpus calls the part it wants; `seedDatabase` is all three.
 * Re-exported rather than imported directly by each spec so a spec's imports stay inside `src`.
 */
export {
  seedDatabase as seedAll,
  seedInboundMessages,
  seedPolicyRules,
  seedRateCard,
} from '../../../prisma/seed-lib';

/** A minimal InboundMessage + Case + Run, for a test that needs a real run to save against. */
export async function createTestRun(prisma: PrismaClient, idSuffix: string) {
  const message = await prisma.inboundMessage.create({
    data: {
      id: `msg-${idSuffix}`,
      fromAddress: 'test@example.com',
      fromName: 'Test Sender',
      subject: 'Test',
      body: 'Test body',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const testCase = await prisma.case.create({
    data: { id: `case-${idSuffix}`, inboundMessageId: message.id },
  });
  return prisma.run.create({
    data: {
      id: `run-${idSuffix}`,
      caseId: testCase.id,
      modelId: 'mock',
      promptVersion: 'v1',
      maxSteps: 10,
    },
  });
}

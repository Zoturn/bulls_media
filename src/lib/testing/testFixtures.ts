import type { PrismaClient } from '@prisma/client';
import { POLICY_RULES, RATE_CARD, SEED } from '../../../prisma/seed-data';

/**
 * The seeding and fixture-creation steps every service- and tool-level integration test repeats:
 * insert the seeded rate card or policy rules, or create a minimal Case + Run to save an
 * assessment against. One implementation here rather than six-plus near-identical copies across
 * spec files, so a change to the seeding convention (or a new required field on `Run`) is one
 * edit, not a hunt through every test file that creates one.
 */

export async function seedRateCard(prisma: PrismaClient): Promise<void> {
  await prisma.rateCardPackage.createMany({
    data: RATE_CARD.map((pkg) => ({ ...pkg, createdAt: new Date(SEED.seededAt) })),
  });
}

export async function seedPolicyRules(prisma: PrismaClient): Promise<void> {
  await prisma.policyRule.createMany({
    data: POLICY_RULES.map((rule) => ({ ...rule, createdAt: new Date(SEED.seededAt) })),
  });
}

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

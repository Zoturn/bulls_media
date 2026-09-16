import type { PrismaClient } from '@prisma/client';
import { POLICY_RULES, RATE_CARD, SEED } from './seed-data';

/**
 * The actual seeding logic, with no module-load side effect — `prisma/seed.ts` (the CLI entry
 * point Prisma runs) and the Cypress `reseed` task (cypress.config.ts) both call this, so there
 * is one implementation of "what seeding means" rather than two that can drift apart.
 */
// Each table is seeded by its own exported function so a test that needs only part of the corpus
// — policy rules but no rate card, messages but neither — calls the same code the real seed runs
// rather than writing a third version of it. See src/lib/testing/testFixtures.ts, which re-exports
// these rather than reimplementing them.
//
// createdAt is passed explicitly rather than left to the column's `@default(now())`: that default
// is exactly the kind of clock read the "seed is deterministic" requirement forbids, and it would
// otherwise make every reseed produce a different timestamp for the same row.
//
// createMany rather than a create() per row: none of these rows reference each other, so one
// statement per table does the same insert as eighteen individual ones.

export async function seedRateCard(prisma: PrismaClient): Promise<void> {
  await prisma.rateCardPackage.createMany({
    data: RATE_CARD.map((pkg) => ({ ...pkg, createdAt: SEED.seededAt })),
  });
}

export async function seedPolicyRules(prisma: PrismaClient): Promise<void> {
  await prisma.policyRule.createMany({
    data: POLICY_RULES.map((rule) => ({ ...rule, createdAt: SEED.seededAt })),
  });
}

export async function seedInboundMessages(prisma: PrismaClient): Promise<void> {
  await prisma.inboundMessage.createMany({ data: Object.values(SEED.messages) });
}

export async function seedDatabase(
  prisma: PrismaClient,
): Promise<{ messages: number; rates: number; policies: number }> {
  await seedRateCard(prisma);
  await seedPolicyRules(prisma);
  await seedInboundMessages(prisma);

  return {
    rates: RATE_CARD.length,
    policies: POLICY_RULES.length,
    messages: Object.keys(SEED.messages).length,
  };
}

/**
 * Deletes exactly what `seedDatabase` creates. `InboundMessage` has no cascade from `Case` (the
 * relation is restrict, on purpose — a message a case still references should not vanish out from
 * under it), so this throws a foreign-key error if any seeded message already has a case built on
 * it. That is deliberately not handled here: once `add-agent-tools` and later changes create
 * cases against these messages, reseeding stops being this simple, and that is a decision for
 * whichever change reaches that point, not a silent workaround here.
 */
// Sequential rather than Promise.all on purpose: a single PrismaClient talks to SQLite over one
// connection, so concurrent writes queue behind each other regardless, and risk a lock-contention
// error for no actual parallelism gained.
export async function clearSeededReferenceData(prisma: PrismaClient): Promise<void> {
  await prisma.inboundMessage.deleteMany();
  await prisma.rateCardPackage.deleteMany();
  await prisma.policyRule.deleteMany();
}

import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed-lib';

/**
 * CLI entry point Prisma runs (`prisma db seed` / `prisma migrate reset`, wired in
 * prisma.config.ts). The actual seeding logic lives in seed-lib.ts, shared with the Cypress
 * `reseed` task in cypress.config.ts — see .claude/rules/data-model.md.
 */

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then((counts) => {
    console.log(
      `Seeded ${counts.rates} rate-card packages, ${counts.policies} policy rules, ` +
        `${counts.messages} inbound messages.`,
    );
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

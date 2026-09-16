import type { PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { rateCardChannelSchema, rateCardPricingUnitSchema } from '@/lib/domain/enums';
import type { RateCardPackageData } from '@/lib/tools/engines/rateCardSearch';

/**
 * The one place `RateCardPackage` is read. Explicit `select` per `.claude/rules/data-model.md`
 * rule 8; `channel` and `pricingUnit` are parsed through their domain schemas on the way out —
 * the boundary where an untyped DB string becomes the typed value the engines expect — so a row
 * written outside this codebase's own writers (there are none yet) fails loudly here rather than
 * silently mis-pricing a quote.
 *
 * Takes an optional client, defaulting to the shared singleton: real callers pass nothing, and a
 * test passes a disposable client pointed at a seeded test database. See
 * .claude/rules/testing.md and src/lib/testing/testDb.ts.
 */
export async function listRateCardPackages(
  client: PrismaClient = db,
): Promise<RateCardPackageData[]> {
  const rows = await client.rateCardPackage.findMany({
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
    },
  });

  return rows.map((row) => ({
    ...row,
    channel: rateCardChannelSchema.parse(row.channel),
    pricingUnit: rateCardPricingUnitSchema.parse(row.pricingUnit),
  }));
}

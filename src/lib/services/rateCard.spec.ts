import type { PrismaClient } from '@prisma/client';
import { createTestDb } from '@/lib/testing/testDb';
import { seedRateCard } from '@/lib/testing/testFixtures';
import { RATE_CARD } from '../../../prisma/seed-data';
import { listRateCardPackages } from './rateCard';

/**
 * A real, seeded database: `listRateCardPackages`'s job is turning DB rows into
 * `RateCardPackageData`, including the `rateCardChannelSchema`/`rateCardPricingUnitSchema` parse
 * on the way out — a mock would only prove the mock returns what it was told, never that this
 * parse actually succeeds against a real row.
 */
let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('ratecard-service'));
}, 30_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await seedRateCard(prisma);
});

afterEach(async () => {
  await prisma.rateCardPackage.deleteMany();
});

describe('listRateCardPackages', () => {
  it('returns every seeded package', async () => {
    const packages = await listRateCardPackages(prisma);
    expect(packages).toHaveLength(RATE_CARD.length);
    expect(packages.map((p) => p.id).sort()).toEqual(RATE_CARD.map((p) => p.id).sort());
  });

  it('parses channel and pricingUnit into their typed domain values, not raw strings', async () => {
    const packages = await listRateCardPackages(prisma);
    const newsletter = packages.find((p) => p.id === 'rate-newsletter-sponsorship');

    expect(newsletter?.channel).toBe('newsletter');
    expect(newsletter?.pricingUnit).toBe('PER_UNIT');
  });

  it('returns every field the engines need, with no further lookup required', async () => {
    const packages = await listRateCardPackages(prisma);
    const pkg = packages[0];

    expect(pkg).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      channel: expect.any(String),
      format: expect.any(String),
      unitPriceCents: expect.any(Number),
      pricingUnit: expect.any(String),
      availableVolume: expect.any(Number),
      minFlightDays: expect.any(Number),
      maxFlightDays: expect.any(Number),
    });
  });
});

import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { callTool } from '@/lib/testing/callTool';
import { createTestDb } from '@/lib/testing/testDb';
import { seedRateCard } from '@/lib/testing/testFixtures';
import {
  createSearchRateCardTool,
  searchRateCardInputSchema,
  type searchRateCardOutputSchema,
} from './searchRateCard';

type SearchRateCardOutput = z.infer<typeof searchRateCardOutputSchema>;

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('search-rate-card-tool'));
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

describe('searchRateCardTool', () => {
  it('finds a seeded package by channel', async () => {
    const searchRateCardTool = createSearchRateCardTool(prisma);
    const result = await callTool<SearchRateCardOutput>(searchRateCardTool, {
      query: 'newsletter',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((p) => p.id)).toContain('rate-newsletter-sponsorship');
  });

  it('returns an empty list for a query matching nothing', async () => {
    const searchRateCardTool = createSearchRateCardTool(prisma);
    const result = await callTool<SearchRateCardOutput>(searchRateCardTool, {
      query: 'zzzznonexistentzzzz',
    });

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('caches the index across repeated calls on the same tool instance', async () => {
    const searchRateCardTool = createSearchRateCardTool(prisma);
    await callTool<SearchRateCardOutput>(searchRateCardTool, { query: 'display' });

    // Adding a new package after the first call must not appear in a second call — proves the
    // index is genuinely cached, not silently rebuilt every time.
    await prisma.rateCardPackage.create({
      data: {
        id: 'rate-podcast-new',
        name: 'Podcast Spot',
        channel: 'audio',
        format: ':30',
        unitPriceCents: 1000,
        pricingUnit: 'PER_THOUSAND',
        availableVolume: 100_000,
        minFlightDays: 1,
        maxFlightDays: 10,
        createdAt: new Date(),
      },
    });

    const result = await callTool<SearchRateCardOutput>(searchRateCardTool, { query: 'podcast' });
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('rejects a query shorter than 2 characters at the schema', () => {
    expect(searchRateCardInputSchema.safeParse({ query: 'a' }).success).toBe(false);
  });

  it('rejects an invalid channel at the schema', () => {
    expect(
      searchRateCardInputSchema.safeParse({ query: 'display', channel: 'print' }).success,
    ).toBe(false);
  });
});

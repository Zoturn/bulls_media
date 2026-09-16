import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { callTool } from '@/lib/testing/callTool';
import { createTestDb } from '@/lib/testing/testDb';
import { seedRateCard } from '@/lib/testing/testFixtures';
import {
  calculateQuoteInputSchema,
  createCalculateQuoteTool,
  type calculateQuoteOutputSchema,
} from './calculateQuote';

type CalculateQuoteOutput = z.infer<typeof calculateQuoteOutputSchema>;

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('calculate-quote-tool'));
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

describe('calculateQuoteTool', () => {
  it('prices a seeded package against real data', async () => {
    const calculateQuoteTool = createCalculateQuoteTool(prisma);
    const result = await callTool<CalculateQuoteOutput>(calculateQuoteTool, {
      lineItems: [{ packageId: 'rate-display-ros', requestedVolume: 1_000_000 }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 1,000,000 of 5,000,000 available = 20%, below the first discount tier.
    expect(result.data.totalCents).toBe(800_000);
  });

  it('fails naming the offending package id for an unknown package', async () => {
    const calculateQuoteTool = createCalculateQuoteTool(prisma);
    const result = await callTool<CalculateQuoteOutput>(calculateQuoteTool, {
      lineItems: [{ packageId: 'does-not-exist', requestedVolume: 1 }],
    });

    expect(result).toEqual({ ok: false, reason: 'PACKAGE_NOT_FOUND', packageId: 'does-not-exist' });
  });

  it('rejects an empty lineItems array at the schema', () => {
    expect(calculateQuoteInputSchema.safeParse({ lineItems: [] }).success).toBe(false);
  });

  it('rejects a non-positive requestedVolume at the schema', () => {
    expect(
      calculateQuoteInputSchema.safeParse({
        lineItems: [{ packageId: 'x', requestedVolume: 0 }],
      }).success,
    ).toBe(false);
  });
});

import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { callTool } from '@/lib/testing/callTool';
import { createTestDb } from '@/lib/testing/testDb';
import { seedRateCard } from '@/lib/testing/testFixtures';
import {
  createLookupInventoryTool,
  lookupInventoryInputSchema,
  type lookupInventoryOutputSchema,
} from './lookupInventory';

type LookupInventoryOutput = z.infer<typeof lookupInventoryOutputSchema>;

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('lookup-inventory-tool'));
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

describe('lookupInventoryTool', () => {
  it('reports available for a seeded package within its volume', async () => {
    const lookupInventoryTool = createLookupInventoryTool(prisma);
    const result = await callTool<LookupInventoryOutput>(lookupInventoryTool, {
      packageId: 'rate-newsletter-sponsorship',
      requestedVolume: 10,
    });

    expect(result).toEqual({
      ok: true,
      data: { status: 'AVAILABLE', packageId: 'rate-newsletter-sponsorship', availableVolume: 40 },
    });
  });

  it('reports insufficient with the actual available volume', async () => {
    const lookupInventoryTool = createLookupInventoryTool(prisma);
    const result = await callTool<LookupInventoryOutput>(lookupInventoryTool, {
      packageId: 'rate-newsletter-sponsorship',
      requestedVolume: 41,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        status: 'INSUFFICIENT',
        packageId: 'rate-newsletter-sponsorship',
        requestedVolume: 41,
        availableVolume: 40,
      },
    });
  });

  it('reports not-found for an unknown package id', async () => {
    const lookupInventoryTool = createLookupInventoryTool(prisma);
    const result = await callTool<LookupInventoryOutput>(lookupInventoryTool, {
      packageId: 'does-not-exist',
      requestedVolume: 1,
    });

    expect(result).toEqual({ ok: false, reason: 'PACKAGE_NOT_FOUND', packageId: 'does-not-exist' });
  });

  it('rejects a zero requested volume at the schema', () => {
    expect(
      lookupInventoryInputSchema.safeParse({ packageId: 'x', requestedVolume: 0 }).success,
    ).toBe(false);
  });

  it('rejects a negative requested volume at the schema', () => {
    expect(
      lookupInventoryInputSchema.safeParse({ packageId: 'x', requestedVolume: -5 }).success,
    ).toBe(false);
  });
});

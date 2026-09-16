import type { PrismaClient } from '@prisma/client';
import { callTool } from '@/lib/testing/callTool';
import { createTestDb } from '@/lib/testing/testDb';
import { seedPolicyRules } from '@/lib/testing/testFixtures';
import {
  checkAdPolicyInputSchema,
  createCheckAdPolicyTool,
  type checkAdPolicyOutputSchema,
} from './checkAdPolicy';
import type { z } from 'zod';

type CheckAdPolicyOutput = z.infer<typeof checkAdPolicyOutputSchema>;

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('check-ad-policy-tool'));
}, 30_000);

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await seedPolicyRules(prisma);
});

afterEach(async () => {
  await prisma.policyRule.deleteMany();
});

describe('checkAdPolicyTool', () => {
  it('returns REFUSE for a seeded prohibited vertical', async () => {
    const checkAdPolicyTool = createCheckAdPolicyTool(prisma);
    const result = await callTool<CheckAdPolicyOutput>(checkAdPolicyTool, { vertical: 'gambling' });

    expect(result).toMatchObject({ ok: true, data: { decision: 'REFUSE' } });
  });

  it('falls back to the general rule for an unrecognised vertical', async () => {
    const checkAdPolicyTool = createCheckAdPolicyTool(prisma);
    const result = await callTool<CheckAdPolicyOutput>(checkAdPolicyTool, {
      vertical: 'artisanal cheese',
    });

    expect(result).toMatchObject({ ok: true, data: { decision: 'ALLOW', matchedVertical: false } });
  });

  it('rejects an empty vertical at the schema, before execute runs', () => {
    expect(checkAdPolicyInputSchema.safeParse({ vertical: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only vertical at the schema', () => {
    expect(checkAdPolicyInputSchema.safeParse({ vertical: '   ' }).success).toBe(false);
  });
});

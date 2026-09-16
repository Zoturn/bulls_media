import type { PrismaClient } from '@prisma/client';
import { createTestDb } from '@/lib/testing/testDb';
import { seedPolicyRules } from '@/lib/testing/testFixtures';
import { POLICY_RULES } from '../../../prisma/seed-data';
import { listPolicyRules } from './policy';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('policy-service'));
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

describe('listPolicyRules', () => {
  it('returns every seeded rule', async () => {
    const rules = await listPolicyRules(prisma);
    expect(rules).toHaveLength(POLICY_RULES.length);
    expect(rules.map((r) => r.id).sort()).toEqual(POLICY_RULES.map((r) => r.id).sort());
  });

  it('parses decision into its typed domain value', async () => {
    const rules = await listPolicyRules(prisma);
    const gambling = rules.find((r) => r.vertical === 'gambling');

    expect(gambling?.decision).toBe('REFUSE');
  });
});

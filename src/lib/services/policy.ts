import type { PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { policyDecisionSchema } from '@/lib/domain/enums';
import type { PolicyRuleData } from '@/lib/tools/engines/policy';

/**
 * The one place `PolicyRule` is read. Explicit `select` per `.claude/rules/data-model.md` rule 8;
 * `decision` is parsed through its domain schema on the way out. See `rateCard.ts` for the same
 * pattern and why the client is injectable.
 */
export async function listPolicyRules(client: PrismaClient = db): Promise<PolicyRuleData[]> {
  const rows = await client.policyRule.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, vertical: true, decision: true, description: true },
  });

  return rows.map((row) => ({
    ...row,
    decision: policyDecisionSchema.parse(row.decision),
  }));
}

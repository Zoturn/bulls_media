import type { PrismaClient } from '@prisma/client';
import type { Tool } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { policyDecisionSchema } from '@/lib/domain/enums';
import { listPolicyRules } from '@/lib/services/policy';
import { matchPolicy } from './engines/policy';
import { okSchema } from './schemas';

/**
 * See .claude/rules/agent-tools.md — description is written for the model, code comments for the
 * next engineer. Never refuses to answer: an unrecognised vertical falls back to the seeded
 * `general` rule rather than erroring, so the model always gets a decision to reason from.
 *
 * Built by a factory taking an optional Prisma client, same as the services it wraps — real code
 * takes the default-constructed instance from `agentTools` in ./index.ts; a test builds its own
 * against a disposable database. See openspec/changes/add-agent-tools/design.md.
 */

export const checkAdPolicyInputSchema = z.object({
  vertical: z
    .string()
    .trim()
    .min(1, 'vertical must not be empty')
    .max(100, 'vertical must be 100 characters or fewer'),
});

export const checkAdPolicyOutputSchema = okSchema(
  z.object({
    decision: policyDecisionSchema,
    ruleId: z.string().nullable(),
    description: z.string(),
    matchedVertical: z.boolean(),
  }),
);

export function createCheckAdPolicyTool(
  client?: PrismaClient,
): Tool<z.infer<typeof checkAdPolicyInputSchema>, z.infer<typeof checkAdPolicyOutputSchema>> {
  return tool({
    description:
      'Check whether advertising in a given vertical (industry category, e.g. "gambling", ' +
      '"automotive") is allowed. Returns ALLOW, REVIEW, or REFUSE, plus the policy rule that ' +
      'produced the decision. Always returns a decision — an unrecognised vertical falls back ' +
      'to the general policy rather than failing. Call this before pricing anything.',
    inputSchema: checkAdPolicyInputSchema,
    outputSchema: checkAdPolicyOutputSchema,
    execute: async (input) => {
      const rules = await listPolicyRules(client);
      const result = matchPolicy(rules, input.vertical);
      return checkAdPolicyOutputSchema.parse(result);
    },
  });
}

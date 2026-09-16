import type { PrismaClient } from '@prisma/client';
import type { Tool, ToolSet } from 'ai';
import { tool } from 'ai';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { claimFromSaveCaseInput } from '@/lib/guardrails/claims';
import { checkPostConditions } from '@/lib/guardrails/postconditions';
import { saveAssessment } from '@/lib/services/cases';
import { agentTools, createAgentTools } from '@/lib/tools';
import type { RecordedToolResult } from './phases';
import {
  SAVE_CASE_DESCRIPTION,
  saveCaseInputSchema,
  saveCaseOutputSchema,
} from '@/lib/tools/saveCase';

/**
 * The tool set for one particular run.
 *
 * Everything here is the ordinary tool set from `src/lib/tools` with one substitution: `save_case`
 * is bound to this run's id, so the model is never told the run id and never has to hand it back
 * correctly. A run id in the prompt would be a field the model could get wrong — turning a
 * successful assessment into a RUN_NOT_FOUND — for no benefit, since the orchestrator knows the
 * id and the model has no legitimate reason to choose a different one.
 *
 * `save_case` remains the only tool permitted to write (.claude/rules/agent-tools.md rule 8).
 */

const boundSaveCaseInputSchema = saveCaseInputSchema.omit({ runId: true });

/**
 * `readHistory` is a function rather than an array because the tool is built once, at the top of
 * the run, and must see the tool results recorded since — a snapshot taken before the first step
 * would check every claim against an empty history, which passes everything.
 *
 * Its granularity is a model *step*, not an individual call: results are appended in `onStepEnd`,
 * so a `save_case` executing in the same step as another tool does not see that tool's result.
 * That is why `save_case` is not in the `TRIAGE` allowlist — see the comment on `PHASE_TOOLS` in
 * ./phases.ts. Within the later phases the effect is conservative: a claim whose supporting
 * result landed in the same step is rejected rather than wrongly accepted, and the model is told
 * why and can call again.
 */
export function createRunBoundSaveCaseTool(
  runId: string,
  readHistory: () => readonly RecordedToolResult[],
  client?: PrismaClient,
): Tool<z.infer<typeof boundSaveCaseInputSchema>, z.infer<typeof saveCaseOutputSchema>> {
  return tool({
    description: SAVE_CASE_DESCRIPTION,
    inputSchema: boundSaveCaseInputSchema,
    outputSchema: saveCaseOutputSchema,
    execute: async (input) => {
      // Checked before the write, not after: a guardrail that runs after the row exists is an
      // audit. See .claude/rules/guardrails-and-injection.md rule 5.
      const violations = checkPostConditions(claimFromSaveCaseInput(input), readHistory());
      if (violations.length > 0) {
        return saveCaseOutputSchema.parse({
          ok: false,
          reason: 'POST_CONDITION_FAILED',
          violations,
        });
      }

      const result = await saveAssessment({ ...input, runId }, client);
      return saveCaseOutputSchema.parse(result);
    },
  });
}

/**
 * The four read tools come from `agentTools` untouched when the caller is on the default database
 * — they are stateless apart from `search_rate_card`'s MiniSearch index, which is cached in the
 * instance's closure and would be rebuilt from scratch by every run if this constructed its own.
 * A caller that supplies its own client (every test) gets its own instances against it, which is
 * the isolation it asked for.
 */
export function buildRunTools(
  runId: string,
  readHistory: () => readonly RecordedToolResult[],
  client?: PrismaClient,
): ToolSet {
  const readTools = client === undefined || client === db ? agentTools : createAgentTools(client);
  return { ...readTools, save_case: createRunBoundSaveCaseTool(runId, readHistory, client) };
}

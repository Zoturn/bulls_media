import type { PrismaClient } from '@prisma/client';
import type { Tool, ToolSet } from 'ai';
import { tool } from 'ai';
import type { z } from 'zod';
import { db } from '@/lib/db';
import { saveAssessment } from '@/lib/services/cases';
import { agentTools, createAgentTools } from '@/lib/tools';
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

export function createRunBoundSaveCaseTool(
  runId: string,
  client?: PrismaClient,
): Tool<z.infer<typeof boundSaveCaseInputSchema>, z.infer<typeof saveCaseOutputSchema>> {
  return tool({
    description: SAVE_CASE_DESCRIPTION,
    inputSchema: boundSaveCaseInputSchema,
    outputSchema: saveCaseOutputSchema,
    execute: async (input) => {
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
export function buildRunTools(runId: string, client?: PrismaClient): ToolSet {
  const readTools = client === undefined || client === db ? agentTools : createAgentTools(client);
  return { ...readTools, save_case: createRunBoundSaveCaseTool(runId, client) };
}

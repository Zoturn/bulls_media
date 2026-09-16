import type { PrismaClient } from '@prisma/client';
import type { Tool } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { assessmentDispositionSchema } from '@/lib/domain/enums';
import { saveAssessment } from '@/lib/services/cases';
import { failSchema, okSchema } from './schemas';

/**
 * The only write tool. See .claude/rules/agent-tools.md rule 8 and
 * openspec/changes/add-agent-tools/design.md on the ALREADY_SAVED/RUN_NOT_FOUND failure modes.
 */

export const saveCaseInputSchema = z.object({
  runId: z.string().min(1),
  disposition: assessmentDispositionSchema,
  summary: z.string().min(1, 'summary must not be empty'),
  structured: z.string().min(1, 'structured must be a non-empty JSON string'),
  refusalReason: z.string().optional(),
  quoteCents: z.number().int().nonnegative().optional(),
  draftReply: z.string().optional(),
});

// A plain union, not discriminatedUnion: both failure variants share ok: false, so `ok` alone
// cannot pick the branch — `reason` would be the discriminant, and Zod's discriminatedUnion only
// supports one key. Two variants is few enough that the plain union's cost is negligible.
export const saveCaseOutputSchema = z.union([
  okSchema(z.object({ assessmentId: z.string() })),
  failSchema('RUN_NOT_FOUND'),
  failSchema('ALREADY_SAVED'),
]);

/**
 * What the model is told this tool does. Exported because `src/lib/agent/tools.ts` builds a
 * run-bound variant of this tool and must describe it identically — this description is read by
 * the model and lands in the trace (.claude/rules/agent-tools.md rule 6), so two copies would be
 * two things the agent believes about the same tool.
 */
export const SAVE_CASE_DESCRIPTION =
  'Save the final assessment for this enquiry — disposition, structured result, quote (only ' +
  'when disposition is QUOTED), refusal reason (only when REFUSED), and drafted reply. The only ' +
  'tool permitted to write anything. Call it once, when you have decided the outcome. Fails with ' +
  'RUN_NOT_FOUND for an unknown run, or ALREADY_SAVED if an assessment has already been saved — ' +
  'it never overwrites one.';

export function createSaveCaseTool(
  client?: PrismaClient,
): Tool<z.infer<typeof saveCaseInputSchema>, z.infer<typeof saveCaseOutputSchema>> {
  return tool({
    description: SAVE_CASE_DESCRIPTION,
    inputSchema: saveCaseInputSchema,
    outputSchema: saveCaseOutputSchema,
    execute: async (input) => {
      const result = await saveAssessment(input, client);
      return saveCaseOutputSchema.parse(result);
    },
  });
}

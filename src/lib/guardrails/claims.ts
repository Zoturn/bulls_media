import { assessmentSchema, type Assessment } from '@/lib/agent/assessment';
import type { AssessmentClaim } from './postconditions';
import type { saveCaseInputSchema } from '@/lib/tools/saveCase';
import type { z } from 'zod';

/**
 * The two adapters that turn each boundary's artefact into the one shape `checkPostConditions`
 * understands.
 *
 * They exist so the checks never learn which boundary called them. That is what makes "the same
 * check runs over the saved row and the returned answer" true rather than approximately true —
 * there is one implementation of each check, not one per caller that might drift.
 */

type SaveCaseInput = z.infer<typeof saveCaseInputSchema>;

/**
 * The claim a `save_case` call is making, before its row is written.
 *
 * The vertical is dug out of the `structured` JSON rather than skipped. It would be easier to
 * leave it to the run-close boundary, but those are different artefacts: run close checks the
 * vertical in the model's *returned answer*, while this is the one that gets **persisted** and
 * later rendered to a human for approval. Checking only the former would let a model save a row
 * naming a vertical policy was never asked about and then return a clean answer, passing both
 * boundaries while the stored record says something no tool result supports.
 *
 * A `structured` payload that does not parse contributes no vertical — it is not the assessment,
 * so there is nothing to check it against, and the disposition and quote checks still apply.
 */
export function claimFromSaveCaseInput(input: Omit<SaveCaseInput, 'runId'>): AssessmentClaim {
  return {
    disposition: input.disposition,
    vertical: verticalWithin(input.structured),
    quoteCents: input.quoteCents,
  };
}

function verticalWithin(structured: string): string | undefined {
  try {
    const parsed = assessmentSchema.safeParse(JSON.parse(structured));
    return parsed.success ? claimFromAssessment(parsed.data).vertical : undefined;
  } catch {
    // Not JSON at all. The tool's own schema only requires a non-empty string here.
    return undefined;
  }
}

/** The claim the model's structured answer is making, before it sets the run's status. */
export function claimFromAssessment(assessment: Assessment): AssessmentClaim {
  const { outcome } = assessment;
  return {
    disposition: outcome.disposition,
    vertical: 'brief' in outcome ? (outcome.brief?.vertical ?? undefined) : undefined,
    quoteCents: outcome.disposition === 'QUOTED' ? outcome.quote.totalCents : undefined,
  };
}

import type { RecordedToolResult } from '@/lib/agent/phases';
import { dispositionToRunStatus } from '@/lib/agent/assessment';
import type { AssessmentDisposition, TerminalRunStatus } from '@/lib/domain/enums';
import { checkAdPolicyOutputSchema } from '@/lib/tools/checkAdPolicy';

/**
 * Refusal as a fact about the run rather than a conclusion the model reached.
 *
 * `.claude/rules/guardrails-and-injection.md` rule 4: if `check_ad_policy` returns REFUSE, the run
 * is refused regardless of what the model went on to say. A guardrail whose effect depends on the
 * model agreeing with it is not a guardrail — it is a request, and this product's inputs are
 * written by people with an interest in the answer.
 */

/** The refusal on record, if there is one: which rule refused, and about what. */
export interface RefusalEvidence {
  ruleId: string | null;
  vertical: string;
  description: string;
}

/**
 * The first recorded REFUSE, with the rule behind it. First rather than last because refusal is
 * sticky (see `phaseFor`): the decision that refused the run is the one that took effect.
 */
export function refusalEvidence(
  history: readonly RecordedToolResult[],
): RefusalEvidence | undefined {
  for (const entry of history) {
    if (entry.toolName !== 'check_ad_policy') continue;
    const parsed = checkAdPolicyOutputSchema.safeParse(entry.output);
    if (!parsed.success || parsed.data.data.decision !== 'REFUSE') continue;

    // The vertical comes from what the tool was asked, not from anything the model wrote down.
    const asked = entry.input;
    const vertical =
      typeof asked === 'object' && asked !== null && 'vertical' in asked
        ? String((asked as { vertical: unknown }).vertical)
        : 'an unrecorded vertical';

    return {
      ruleId: parsed.data.data.ruleId,
      vertical,
      description: parsed.data.data.description,
    };
  }
  return undefined;
}

/**
 * The run's terminal status, with code having the last word over the model's disposition.
 *
 * A refusal on record produces REFUSED whatever was claimed — and whether or not anything was
 * claimed at all. That second part matters: a model that is refused and then burns its step
 * budget has still had its enquiry refused, and closing that run FAILED would present a settled
 * policy decision as an infrastructure problem for someone to retry. The failure is not lost; it
 * is recorded on the run and in its terminal step.
 *
 * An absent disposition — no parseable answer — is FAILED, because nothing was decided.
 */
export function enforcedStatusFor(
  history: readonly RecordedToolResult[],
  disposition: AssessmentDisposition | undefined,
): TerminalRunStatus {
  if (refusalEvidence(history) !== undefined) return 'REFUSED';
  if (disposition === undefined) return 'FAILED';
  return dispositionToRunStatus(disposition);
}

/** The sentence an operator reads when a run was refused — which rule, and about what (rule 10). */
export function describeRefusal(evidence: RefusalEvidence): string {
  const rule = evidence.ruleId ?? 'the default policy';
  return `Refused by ${rule} for the vertical "${evidence.vertical}": ${evidence.description}`;
}

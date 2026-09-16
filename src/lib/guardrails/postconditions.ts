import { z } from 'zod';
import type { AssessmentDisposition } from '@/lib/domain/enums';
import type { RecordedToolResult } from '@/lib/agent/phases';
import { checkAdPolicyInputSchema, checkAdPolicyOutputSchema } from '@/lib/tools/checkAdPolicy';
import { calculateQuoteOutputSchema } from '@/lib/tools/calculateQuote';

/**
 * Comparing what the agent says happened against what the tools actually returned.
 *
 * The phase gate in `src/lib/agent/phases.ts` controls what the model can reach. This controls what
 * the system will believe. They fail differently: the gate holds against a model trying to get past
 * it, and this holds when every tool call was legitimate and the model simply wrote the wrong
 * number down — which is the more likely failure by some margin.
 *
 * Pure: a claim and a history in, violations out. No database, no model, no clock. That is what
 * makes it the deterministic check `.claude/rules/guardrails-and-injection.md` rule 5 asks for —
 * a model summarising its own work is not evidence that the work was done.
 */

/** The names are stable: they are recorded on the run and rendered to an operator. */
export const POST_CONDITION_CHECKS = [
  'QUOTE_TOTAL_MATCHES_CALCULATION',
  'QUOTE_HAS_A_CALCULATION',
  'REFUSAL_CARRIES_NO_QUOTE',
  'VERTICAL_WAS_ASSESSED',
  'DISPOSITION_MATCHES_POLICY',
] as const;
export type PostConditionCheck = (typeof POST_CONDITION_CHECKS)[number];

/**
 * A schema rather than a bare interface, because this payload crosses a tool boundary:
 * `save_case` returns it to the model, so it is validated on the way out and the check name is
 * the enum above rather than a free string a typo could slip through
 * (.claude/rules/typescript.md rule 3 — one description, not two).
 */
export const postConditionViolationSchema = z.object({
  check: z.enum(POST_CONDITION_CHECKS),
  /** What the assessment said. */
  claimed: z.string(),
  /** What the recorded tool results said instead. Phrased for an operator, not a log parser. */
  recorded: z.string(),
});
export type PostConditionViolation = z.infer<typeof postConditionViolationSchema>;

/**
 * The normalised claim, produced by an adapter at each boundary so the checks themselves never
 * know whether they were called from the write tool or from the end of the run.
 */
export interface AssessmentClaim {
  disposition: AssessmentDisposition;
  /** The vertical the assessment reports having assessed. Absent when it extracted no brief. */
  vertical?: string;
  /** The total the assessment reports. Absent when it claims no quote. */
  quoteCents?: number;
}

// ---------------------------------------------------------------------------------------------
// Reading the history. Every read goes through the tool's own output schema rather than duck
// typing, so a result that merely looks like a tool result does not count as one.
// ---------------------------------------------------------------------------------------------

function outputsOf(history: readonly RecordedToolResult[], toolName: string): unknown[] {
  return history.filter((entry) => entry.toolName === toolName).map((entry) => entry.output);
}

function inputsOf(history: readonly RecordedToolResult[], toolName: string): unknown[] {
  return history.filter((entry) => entry.toolName === toolName).map((entry) => entry.input);
}

// `flatMap` with an empty array for the misses, rather than `.filter(p => p.success).map(...)`:
// a filter does not narrow the union for the map that follows it, so the map would be reading
// `.data` off a type that may not have it. This way the narrowing is inside one callback and the
// compiler can see it.

/** Every total `calculate_quote` actually returned on this run. */
function calculatedTotals(history: readonly RecordedToolResult[]): number[] {
  return outputsOf(history, 'calculate_quote').flatMap((output) => {
    const parsed = calculateQuoteOutputSchema.safeParse(output);
    return parsed.success && parsed.data.ok ? [parsed.data.data.totalCents] : [];
  });
}

/** Every vertical `check_ad_policy` was actually asked about, lowercased for comparison. */
function assessedVerticals(history: readonly RecordedToolResult[]): string[] {
  return inputsOf(history, 'check_ad_policy').flatMap((input) => {
    const parsed = checkAdPolicyInputSchema.safeParse(input);
    return parsed.success ? [parsed.data.vertical.trim().toLowerCase()] : [];
  });
}

/** Every policy decision `check_ad_policy` actually returned. */
export function recordedPolicyDecisions(history: readonly RecordedToolResult[]): string[] {
  return outputsOf(history, 'check_ad_policy').flatMap((output) => {
    const parsed = checkAdPolicyOutputSchema.safeParse(output);
    return parsed.success ? [parsed.data.data.decision] : [];
  });
}

// ---------------------------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------------------------

export function checkPostConditions(
  claim: AssessmentClaim,
  history: readonly RecordedToolResult[],
): PostConditionViolation[] {
  const violations: PostConditionViolation[] = [];
  const totals = calculatedTotals(history);
  const decisions = recordedPolicyDecisions(history);

  if (claim.disposition === 'QUOTED') {
    if (totals.length === 0) {
      violations.push({
        check: 'QUOTE_HAS_A_CALCULATION',
        claimed: `a quote of ${claim.quoteCents ?? 'an unstated amount'} cents`,
        recorded: 'calculate_quote never returned a successful result on this run',
      });
    } else if (claim.quoteCents === undefined || !totals.includes(claim.quoteCents)) {
      // Any recorded total, not only the most recent: a model that revises after an inventory
      // shortfall legitimately produces several. See this change's design.md on that trade-off.
      violations.push({
        check: 'QUOTE_TOTAL_MATCHES_CALCULATION',
        claimed: `a total of ${claim.quoteCents ?? 'no amount'} cents`,
        recorded: `calculate_quote returned ${totals.join(' and ')} cents`,
      });
    }
  }

  // Checked independently of the disposition check above: a refusal carrying a price is a
  // contradiction worth recording, not a field to quietly drop.
  if (claim.disposition === 'REFUSED' && claim.quoteCents !== undefined) {
    violations.push({
      check: 'REFUSAL_CARRIES_NO_QUOTE',
      claimed: `a refusal carrying a quote of ${claim.quoteCents} cents`,
      recorded: 'a refused enquiry is not priced',
    });
  }

  if (claim.vertical !== undefined) {
    const verticals = assessedVerticals(history);
    const claimed = claim.vertical.trim().toLowerCase();
    if (!verticals.includes(claimed)) {
      violations.push({
        check: 'VERTICAL_WAS_ASSESSED',
        claimed: `the vertical "${claim.vertical}"`,
        recorded:
          verticals.length === 0
            ? 'check_ad_policy was never called on this run'
            : `check_ad_policy was asked about ${verticals.map((v) => `"${v}"`).join(' and ')}`,
      });
    }
  }

  // A REFUSE on record and any disposition but REFUSED is a contradiction. The run's *status* is
  // forced to REFUSED regardless (see ./refusal.ts) — this records that the agent disagreed,
  // because a correct-looking outcome hiding a wrong assessment is the thing worth surfacing.
  if (decisions.includes('REFUSE') && claim.disposition !== 'REFUSED') {
    violations.push({
      check: 'DISPOSITION_MATCHES_POLICY',
      claimed: `a disposition of ${claim.disposition}`,
      recorded: 'check_ad_policy returned REFUSE on this run',
    });
  }

  return violations;
}

/** One line per violation, for a run's `errorMessage` and for an operator reading a trace. */
export function describeViolations(violations: readonly PostConditionViolation[]): string {
  return violations.map((v) => `${v.check}: claimed ${v.claimed}, but ${v.recorded}`).join('; ');
}

import type { PolicyDecision } from '@/lib/domain/enums';
import { checkAdPolicyOutputSchema } from '@/lib/tools/checkAdPolicy';
import { lookupInventoryOutputSchema } from '@/lib/tools/lookupInventory';
import { calculateQuoteOutputSchema } from '@/lib/tools/calculateQuote';

/**
 * Which tools exist at a given moment, decided from what has already happened.
 *
 * Both functions here are pure and synchronous: no database, no model, no clock. That is the
 * whole point. A phase the model could assert is a bound the model could lift, so the phase is
 * derived from recorded tool *results* — outputs the tools themselves produced — and an inbound
 * message insisting that policy has already been checked moves nothing.
 *
 * See .claude/rules/agent-orchestration.md rule 2 and this change's design.md.
 */

// A plain literal union, not a Zod enum like the value spaces in src/lib/domain/enums.ts: those
// exist because a `String` column has to be parsed back into a type at a boundary. A phase never
// crosses one — it is computed, used and discarded inside this process — so a schema here would
// be one nothing ever calls `.parse` on.
export const AGENT_PHASES = ['TRIAGE', 'RESEARCH', 'PRICING', 'PERSIST'] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

/**
 * Taken from `agentTools` through a type-only `import()`, so renaming a tool breaks this table at
 * compile time — and so this module never pulls the tool instances (and their database client)
 * into a test that only wants to walk the phase machine.
 */
export type AgentToolName = keyof typeof import('@/lib/tools').agentTools & string;

/**
 * `save_case` is in every phase EXCEPT `TRIAGE`, and the exception is load-bearing.
 *
 * It is in the later phases so that a run which cannot find inventory can still record
 * `NEEDS_INFO` and stop, rather than sitting in `RESEARCH` until its step budget runs out. The
 * gate worth enforcing is "nothing is priced before policy is known", not "nothing is recorded
 * early", and an early save is terminal and single-shot — `Assessment.runId` is unique.
 *
 * It is NOT in `TRIAGE` because the post-conditions that guard the write read the tool results
 * recorded so far, and those are appended when a model *step* ends — so a `save_case` executing
 * in the same step as (or before) `check_ad_policy` is checked against a history that does not
 * yet contain the policy decision. Keeping it out of `TRIAGE` means a save can only happen in a
 * phase the policy result already moved the run into, so the decision is always on record by the
 * time a claim is checked against it. Without this, a model could write an assessment before any
 * policy decision existed and nothing would contradict it.
 */
const PHASE_TOOLS = {
  TRIAGE: ['check_ad_policy'],
  RESEARCH: ['search_rate_card', 'lookup_inventory', 'save_case'],
  PRICING: ['calculate_quote', 'save_case'],
  PERSIST: ['save_case'],
} as const satisfies Record<AgentPhase, readonly AgentToolName[]>;

export function activeToolsFor(phase: AgentPhase): AgentToolName[] {
  return [...PHASE_TOOLS[phase]];
}

/**
 * One tool call as the orchestrator recorded it: what it was asked and what it returned, both
 * unvalidated. `input` matters as much as `output` to the guardrails — "which vertical was policy
 * actually asked about" is a question only the input answers.
 */
export interface RecordedToolResult {
  toolName: string;
  input: unknown;
  output: unknown;
}

function outputsOf(history: readonly RecordedToolResult[], toolName: AgentToolName): unknown[] {
  return history.filter((entry) => entry.toolName === toolName).map((entry) => entry.output);
}

/**
 * Every policy decision the tool has actually returned, oldest first. Parsed through the tool's
 * own output schema rather than duck-typed, so a fabricated result that merely looks like a policy
 * decision does not count as one.
 */
function policyDecisions(history: readonly RecordedToolResult[]): PolicyDecision[] {
  return outputsOf(history, 'check_ad_policy')
    .map((output) => checkAdPolicyOutputSchema.safeParse(output))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data.data.decision);
}

/** True once some package has been confirmed to actually have the volume that was asked for. */
function hasConfirmedInventory(history: readonly RecordedToolResult[]): boolean {
  return outputsOf(history, 'lookup_inventory').some((output) => {
    const parsed = lookupInventoryOutputSchema.safeParse(output);
    return parsed.success && parsed.data.ok && parsed.data.data.status === 'AVAILABLE';
  });
}

/** True once `calculate_quote` has actually produced a total. */
function hasQuote(history: readonly RecordedToolResult[]): boolean {
  return outputsOf(history, 'calculate_quote').some((output) => {
    const parsed = calculateQuoteOutputSchema.safeParse(output);
    return parsed.success && parsed.data.ok;
  });
}

/**
 * The phase the run is in, given everything its tools have returned so far. A REFUSE decision
 * skips research and pricing entirely — those tools are never offered on a refused run, so there
 * is no path by which a refused vertical gets priced.
 */
export function phaseFor(history: readonly RecordedToolResult[]): AgentPhase {
  const decisions = policyDecisions(history);
  if (decisions.length === 0) return 'TRIAGE';

  // A refusal is sticky: ANY refusal on this run sends it to PERSIST, not just the most recent
  // decision. The spec says the pricing tools are "never offered on that run", and with
  // latest-decision-wins they could be — a model that had been refused could call check_ad_policy
  // a second time with a more agreeable vertical and reopen research and pricing. Whether it
  // reclassified in good faith or because the email told it to, the answer is the same: a run
  // that has been refused once is refused.
  if (decisions.includes('REFUSE')) return 'PERSIST';

  if (!hasConfirmedInventory(history)) return 'RESEARCH';
  if (!hasQuote(history)) return 'PRICING';
  return 'PERSIST';
}

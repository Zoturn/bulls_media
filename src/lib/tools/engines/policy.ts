import type { PolicyDecision } from '@/lib/domain/enums';

/**
 * Pure policy-matching logic: plain data in, plain data out, no Prisma import, no network. The
 * `check_ad_policy` tool supplies the real rows; a test supplies fixture rows. See
 * .claude/rules/agent-tools.md rule 5 — the decision comes from data, never from prose.
 */

export interface PolicyRuleData {
  id: string;
  vertical: string;
  decision: PolicyDecision;
  description: string;
}

export interface PolicyMatch {
  decision: PolicyDecision;
  ruleId: string | null;
  description: string;
  matchedVertical: boolean;
}

const FALLBACK_VERTICAL = 'general';

/**
 * Three tiers, in order: an exact (case-insensitive) match on the vertical; the seeded
 * `general` rule when nothing matches; and, only if even that row is missing — a data
 * integrity problem, not a normal outcome — a hardcoded REFUSE. Failing closed here means a
 * broken or incomplete policy table blocks a sale rather than silently allowing one.
 *
 * Always returns `{ ok: true, data }`: there is no vertical this function refuses to produce a
 * decision for, so there is nothing here for a caller to treat as a tool failure. Callers still
 * receive a discriminated shape for consistency with every other tool's output.
 */
export function matchPolicy(
  rules: readonly PolicyRuleData[],
  vertical: string,
): { ok: true; data: PolicyMatch } {
  const normalized = vertical.trim().toLowerCase();

  const exact = rules.find((rule) => rule.vertical.toLowerCase() === normalized);
  if (exact) {
    return {
      ok: true,
      data: {
        decision: exact.decision,
        ruleId: exact.id,
        description: exact.description,
        matchedVertical: true,
      },
    };
  }

  const fallback = rules.find((rule) => rule.vertical.toLowerCase() === FALLBACK_VERTICAL);
  if (fallback) {
    return {
      ok: true,
      data: {
        decision: fallback.decision,
        ruleId: fallback.id,
        description: fallback.description,
        matchedVertical: false,
      },
    };
  }

  return {
    ok: true,
    data: {
      decision: 'REFUSE',
      ruleId: null,
      description: 'No policy rule matched this vertical, and no fallback rule was configured.',
      matchedVertical: false,
    },
  };
}

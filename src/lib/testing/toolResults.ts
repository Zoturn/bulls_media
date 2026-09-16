import type { RecordedToolResult } from '@/lib/agent/phases';

/**
 * Recorded tool results, as the orchestrator would have appended them.
 *
 * Four spec files were building these by hand in near-identical shapes — which meant that when
 * `RecordedToolResult` gained its `input` field, the field had to be threaded into every copy by
 * hand, and the next field would have to be too. The shapes themselves are the tools' own output
 * schemas, so a fixture that drifts from one stops being a fixture and becomes a fiction the
 * guardrails will correctly ignore.
 */

export function policyResult(
  decision: 'ALLOW' | 'REVIEW' | 'REFUSE',
  vertical = 'automotive',
  ruleId: string | null = `policy-${vertical}`,
): RecordedToolResult {
  return {
    toolName: 'check_ad_policy',
    input: { vertical },
    output: {
      ok: true,
      data: {
        decision,
        ruleId,
        description: `${vertical} is handled by ${ruleId ?? 'the default rule'}.`,
        matchedVertical: true,
      },
    },
  };
}

export function quoteResult(
  totalCents: number,
  packageId = 'rate-display-ros',
  requestedVolume = 1_000_000,
): RecordedToolResult {
  return {
    toolName: 'calculate_quote',
    input: { lineItems: [{ packageId, requestedVolume }] },
    output: {
      ok: true,
      data: {
        lineItems: [
          {
            packageId,
            requestedVolume,
            subtotalCents: totalCents,
            discountCents: 0,
            totalCents,
          },
        ],
        subtotalCents: totalCents,
        discountCents: 0,
        totalCents,
      },
    },
  };
}

export function failedQuoteResult(packageId = 'rate-nope'): RecordedToolResult {
  return {
    toolName: 'calculate_quote',
    input: { lineItems: [{ packageId, requestedVolume: 1 }] },
    output: { ok: false, reason: 'PACKAGE_NOT_FOUND', packageId },
  };
}

export function inventoryAvailable(
  packageId = 'rate-display-ros',
  availableVolume = 5_000_000,
  requestedVolume = 1_000_000,
): RecordedToolResult {
  return {
    toolName: 'lookup_inventory',
    input: { packageId, requestedVolume },
    output: { ok: true, data: { status: 'AVAILABLE', packageId, availableVolume } },
  };
}

export function inventoryInsufficient(
  packageId = 'rate-display-homepage',
  requestedVolume = 900_000,
  availableVolume = 200_000,
): RecordedToolResult {
  return {
    toolName: 'lookup_inventory',
    input: { packageId, requestedVolume },
    output: {
      ok: true,
      data: { status: 'INSUFFICIENT', packageId, requestedVolume, availableVolume },
    },
  };
}

export function inventoryNotFound(packageId = 'rate-nope'): RecordedToolResult {
  return {
    toolName: 'lookup_inventory',
    input: { packageId, requestedVolume: 100 },
    output: { ok: false, reason: 'PACKAGE_NOT_FOUND', packageId },
  };
}

export function searchResult(query = 'display'): RecordedToolResult {
  return {
    toolName: 'search_rate_card',
    input: { query },
    output: { ok: true, data: [] },
  };
}

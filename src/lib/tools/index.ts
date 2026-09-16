import type { PrismaClient } from '@prisma/client';
import type { ToolSet } from 'ai';
import { createCheckAdPolicyTool } from './checkAdPolicy';
import { createSearchRateCardTool } from './searchRateCard';
import { createLookupInventoryTool } from './lookupInventory';
import { createCalculateQuoteTool } from './calculateQuote';
import { createSaveCaseTool } from './saveCase';

/**
 * The one place the five tool names are mapped to the five tools. Everything that needs a tool set
 * — the default singletons below, a test wanting a disposable database, the orchestrator's
 * run-bound set in `src/lib/agent/tools.ts` — goes through here, so a sixth tool is added once
 * rather than in three lists that can disagree about which tools exist.
 */
export function createAgentTools(client?: PrismaClient) {
  return {
    check_ad_policy: createCheckAdPolicyTool(client),
    search_rate_card: createSearchRateCardTool(client),
    lookup_inventory: createLookupInventoryTool(client),
    calculate_quote: createCalculateQuoteTool(client),
    save_case: createSaveCaseTool(client),
  } satisfies ToolSet;
}

/**
 * The process-wide tool set, on the default database connection.
 *
 * Built once at module load, and worth reusing rather than rebuilding per run: `search_rate_card`
 * caches its MiniSearch index in the closure of the instance it belongs to, so a fresh instance
 * re-reads the whole rate card and rebuilds the index on its first call.
 *
 * Inferred, not annotated `: ToolSet`: the annotation would widen the keys to `string`, and
 * `src/lib/agent/phases.ts` derives its phase allowlist from `keyof typeof agentTools`, so
 * renaming a tool here has to break that table at compile time rather than silently emptying a
 * phase at runtime.
 */
export const agentTools = createAgentTools();

export { createCheckAdPolicyTool } from './checkAdPolicy';
export { createSearchRateCardTool } from './searchRateCard';
export { createLookupInventoryTool } from './lookupInventory';
export { createCalculateQuoteTool } from './calculateQuote';
export { createSaveCaseTool } from './saveCase';

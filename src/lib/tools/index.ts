import type { ToolSet } from 'ai';
import { checkAdPolicyTool } from './checkAdPolicy';
import { searchRateCardTool } from './searchRateCard';
import { lookupInventoryTool } from './lookupInventory';
import { calculateQuoteTool } from './calculateQuote';
import { saveCaseTool } from './saveCase';

/**
 * All five tools, ready for `add-agent-orchestrator` to pass to `generateText`/`streamText`.
 * Each uses the default (singleton) database connection — see the individual `create*Tool`
 * factories in this directory for the injectable form a test uses instead.
 */
export const agentTools: ToolSet = {
  check_ad_policy: checkAdPolicyTool,
  search_rate_card: searchRateCardTool,
  lookup_inventory: lookupInventoryTool,
  calculate_quote: calculateQuoteTool,
  save_case: saveCaseTool,
};

export {
  checkAdPolicyTool,
  searchRateCardTool,
  lookupInventoryTool,
  calculateQuoteTool,
  saveCaseTool,
};
export { createCheckAdPolicyTool } from './checkAdPolicy';
export { createSearchRateCardTool } from './searchRateCard';
export { createLookupInventoryTool } from './lookupInventory';
export { createCalculateQuoteTool } from './calculateQuote';
export { createSaveCaseTool } from './saveCase';

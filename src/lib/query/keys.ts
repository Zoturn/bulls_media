/**
 * Query keys as typed factories, not inline arrays — an invalidation that misses by one key
 * element fails silently (.claude/rules/nextjs-and-data-fetching.md rule 5).
 */
export const queryKeys = {
  inbox: () => ['inbox'] as const,
  case: (caseId: string) => ['case', caseId] as const,
};

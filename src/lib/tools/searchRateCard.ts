import type MiniSearch from 'minisearch';
import type { PrismaClient } from '@prisma/client';
import type { Tool } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { rateCardChannelSchema } from '@/lib/domain/enums';
import { neutralise } from '@/lib/guardrails/untrusted';
import { listRateCardPackages } from '@/lib/services/rateCard';
import {
  buildRateCardIndex,
  rateCardPackageDataSchema,
  searchRateCard as searchRateCardEngine,
} from './engines/rateCardSearch';
import { okSchema } from './schemas';

/**
 * See openspec/changes/add-agent-tools/design.md — the index is built from `RateCardPackage`
 * rows, not a separate document corpus, and cached per tool instance: the seeded rate card does
 * not change during a process's lifetime, so rebuilding the index on every call would be pure
 * waste. Built by a factory (see checkAdPolicy.ts) so a test's instance caches its own index
 * against its own disposable database, independent of the real singleton's cache.
 */

export const searchRateCardInputSchema = z.object({
  query: z.string().trim().min(2, 'query must be at least 2 characters').max(200),
  channel: rateCardChannelSchema.optional(),
});

export const searchRateCardOutputSchema = okSchema(z.array(rateCardPackageDataSchema));

export function createSearchRateCardTool(
  client?: PrismaClient,
): Tool<z.infer<typeof searchRateCardInputSchema>, z.infer<typeof searchRateCardOutputSchema>> {
  let cachedIndex: MiniSearch | undefined;

  return tool({
    description:
      'Find rate-card packages matching a free-text query (channel, format, or package name), ' +
      'optionally filtered to one channel (display, video, audio, newsletter). Returns matching ' +
      'packages with their unit price and available volume. An empty list means no package ' +
      'matches — that means we cannot sell it, not that the search failed. Results are for ' +
      'browsing; call lookup_inventory to confirm availability before quoting.',
    inputSchema: searchRateCardInputSchema,
    outputSchema: searchRateCardOutputSchema,
    execute: async (input) => {
      if (!cachedIndex) {
        const packages = await listRateCardPackages(client);
        cachedIndex = buildRateCardIndex(packages);
      }
      const result = searchRateCardEngine(cachedIndex, input.query, input.channel);

      // A rate-card row is a document, and this is the path that turns documents into model
      // input. "We seeded it ourselves" describes today's corpus, not the path — the rows come
      // from a database a later change may let someone else write to, and
      // .claude/rules/guardrails-and-injection.md rule 6 does not exempt them. Only the
      // free-text fields need it; ids, prices and volumes are not strings a delimiter can hide in.
      return searchRateCardOutputSchema.parse({
        ...result,
        data: result.data.map((pkg) => ({
          ...pkg,
          name: neutralise(pkg.name),
          format: neutralise(pkg.format),
        })),
      });
    },
  });
}

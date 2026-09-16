import type { PrismaClient } from '@prisma/client';
import type { Tool } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { listRateCardPackages } from '@/lib/services/rateCard';
import { checkInventory } from './engines/inventory';
import { okSchema, packageNotFoundSchema } from './schemas';

/**
 * The one call `calculate_quote` is allowed to trust for a volume figure. See
 * openspec/changes/add-agent-tools/design.md on why this stays separate from
 * `search_rate_card`'s browsing results.
 */

export const lookupInventoryInputSchema = z.object({
  packageId: z.string().min(1),
  requestedVolume: z.number().int().positive('requestedVolume must be a positive integer'),
});

export const lookupInventoryOutputSchema = z.union([
  okSchema(
    z.object({
      status: z.literal('AVAILABLE'),
      packageId: z.string(),
      availableVolume: z.number().int().nonnegative(),
    }),
  ),
  okSchema(
    z.object({
      status: z.literal('INSUFFICIENT'),
      packageId: z.string(),
      requestedVolume: z.number().int().positive(),
      availableVolume: z.number().int().nonnegative(),
    }),
  ),
  packageNotFoundSchema,
]);

export function createLookupInventoryTool(
  client?: PrismaClient,
): Tool<z.infer<typeof lookupInventoryInputSchema>, z.infer<typeof lookupInventoryOutputSchema>> {
  return tool({
    description:
      'Confirm whether a specific requested volume is currently available for one specific ' +
      'rate-card package id (from search_rate_card). Returns AVAILABLE with the available ' +
      'volume, INSUFFICIENT with the actual available volume, or a not-found failure when the ' +
      'package id is unrecognised. Call this before calculate_quote — a search result alone is ' +
      'not authoritative.',
    inputSchema: lookupInventoryInputSchema,
    outputSchema: lookupInventoryOutputSchema,
    execute: async (input) => {
      const packages = await listRateCardPackages(client);
      const result = checkInventory(packages, input.packageId, input.requestedVolume);
      return lookupInventoryOutputSchema.parse(result);
    },
  });
}

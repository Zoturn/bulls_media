import type { PrismaClient } from '@prisma/client';
import type { Tool } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';
import { listRateCardPackages } from '@/lib/services/rateCard';
import { calculateQuote as calculateQuoteEngine } from './engines/quote';
import { okSchema, packageNotFoundSchema } from './schemas';

/**
 * The arithmetic the model is never allowed to do itself. See .claude/rules/agent-tools.md rule
 * 4 and openspec/changes/add-agent-tools/design.md for the discount design.
 */

export const calculateQuoteInputSchema = z.object({
  lineItems: z
    .array(
      z.object({
        packageId: z.string().min(1),
        requestedVolume: z.number().int().positive('requestedVolume must be a positive integer'),
      }),
    )
    .min(1, 'at least one line item is required'),
});

const pricedLineItemSchema = z.object({
  packageId: z.string(),
  requestedVolume: z.number().int().positive(),
  subtotalCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
});

// discriminatedUnion, not a plain union: the two variants are uniquely keyed by `ok`, so Zod can
// pick the right branch by checking that one field instead of trying each variant in turn, and a
// parse failure names the actual `ok` value it saw rather than "matched none of the variants".
export const calculateQuoteOutputSchema = z.discriminatedUnion('ok', [
  okSchema(
    z.object({
      lineItems: z.array(pricedLineItemSchema),
      subtotalCents: z.number().int().nonnegative(),
      discountCents: z.number().int().nonnegative(),
      totalCents: z.number().int().nonnegative(),
    }),
  ),
  packageNotFoundSchema,
]);

export function createCalculateQuoteTool(
  client?: PrismaClient,
): Tool<z.infer<typeof calculateQuoteInputSchema>, z.infer<typeof calculateQuoteOutputSchema>> {
  return tool({
    description:
      'Compute a quote total in integer cents for one or more rate-card line items ' +
      '(packageId + requestedVolume). Applies the volume discount automatically. This is the ' +
      'only source of a price — never state a total that did not come from this tool. Fails ' +
      'naming the offending package id if any line item references an unknown package, with no ' +
      'partial total computed.',
    inputSchema: calculateQuoteInputSchema,
    outputSchema: calculateQuoteOutputSchema,
    execute: async (input) => {
      const packages = await listRateCardPackages(client);
      const result = calculateQuoteEngine(packages, input.lineItems);
      return calculateQuoteOutputSchema.parse(result);
    },
  });
}

export const calculateQuoteTool = createCalculateQuoteTool();

import MiniSearch from 'minisearch';
import { z } from 'zod';
import { rateCardChannelSchema, rateCardPricingUnitSchema } from '@/lib/domain/enums';

/**
 * A lexical (BM25-family) search over the seeded rate card, built from the same rows
 * `calculate_quote` and `lookup_inventory` read — not a separately authored document corpus. See
 * openspec/changes/add-agent-tools/design.md for why: one source of truth for five packages
 * beats two that can drift. Deterministic for a fixed corpus and query — no network, no clock.
 */

// The one definition of a rate-card package's shape, used by this engine, the search tool's
// outputSchema, and every other engine that reads a package — a type inferred from a schema
// rather than a hand-written interface plus a separately hand-written Zod object, per
// .claude/rules/typescript.md rule 3.
export const rateCardPackageDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  channel: rateCardChannelSchema,
  format: z.string(),
  unitPriceCents: z.number().int().positive(),
  pricingUnit: rateCardPricingUnitSchema,
  availableVolume: z.number().int().nonnegative(),
  minFlightDays: z.number().int().positive(),
  maxFlightDays: z.number().int().positive(),
});

export type RateCardPackageData = z.infer<typeof rateCardPackageDataSchema>;

type IndexedDocument = RateCardPackageData & { id: string };

export function buildRateCardIndex(packages: readonly RateCardPackageData[]): MiniSearch {
  const index = new MiniSearch<IndexedDocument>({
    idField: 'id',
    fields: ['name', 'channel', 'format'],
    storeFields: [
      'id',
      'name',
      'channel',
      'format',
      'unitPriceCents',
      'pricingUnit',
      'availableVolume',
      'minFlightDays',
      'maxFlightDays',
    ],
  });
  index.addAll(packages as IndexedDocument[]);
  return index;
}

/**
 * `prefix: true` and `fuzzy: 0.2` are what make "disp" match "Display" and a small typo still
 * find the right package — reasonable defaults for a five-package rate card, not a tuned
 * relevance system. The `channel` filter runs inside MiniSearch's own `filter` option, so an
 * excluded package is never scored or returned, not merely sorted last.
 *
 * The query is inert search text: MiniSearch scores terms against indexed fields and has no
 * concept of an "instruction," so a query engineered to look like one still only ever changes
 * which packages match, never anything else.
 */
export function searchRateCard(
  index: MiniSearch,
  query: string,
  channel?: RateCardPackageData['channel'],
): { ok: true; data: RateCardPackageData[] } {
  const results = index.search(query, {
    prefix: true,
    fuzzy: 0.2,
    filter: channel ? (result) => result.channel === channel : undefined,
  });

  return {
    ok: true,
    data: results.map((result) => ({
      id: result.id as string,
      name: result.name as string,
      channel: result.channel as RateCardPackageData['channel'],
      format: result.format as string,
      unitPriceCents: result.unitPriceCents as number,
      pricingUnit: result.pricingUnit as RateCardPackageData['pricingUnit'],
      availableVolume: result.availableVolume as number,
      minFlightDays: result.minFlightDays as number,
      maxFlightDays: result.maxFlightDays as number,
    })),
  };
}

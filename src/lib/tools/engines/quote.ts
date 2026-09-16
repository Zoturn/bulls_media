import type { RateCardPackageData } from './rateCardSearch';

/**
 * The arithmetic the model is never allowed to do itself. Integer cents throughout; every
 * discount is floored, never rounded up, so the total never exceeds what the tier-by-tier maths
 * implies. See .claude/rules/agent-tools.md rule 4 and
 * openspec/changes/add-agent-tools/design.md for why the discount is proportional to a package's
 * own available volume rather than an absolute threshold.
 */

export interface QuoteLineItem {
  packageId: string;
  requestedVolume: number;
}

export interface PricedLineItem {
  packageId: string;
  requestedVolume: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export type QuoteResult =
  | {
      ok: true;
      data: {
        lineItems: PricedLineItem[];
        subtotalCents: number;
        discountCents: number;
        totalCents: number;
      };
    }
  | { ok: false; reason: 'PACKAGE_NOT_FOUND'; packageId: string };

/**
 * Proportion of a package's own available volume being requested, mapped to a discount rate.
 *
 * Guards `availableVolume <= 0` explicitly: without this, a sold-out package (0 available) makes
 * `requestedVolume / 0` evaluate to `Infinity` for any positive request, which satisfies every
 * tier check below and silently grants the deepest discount to the one case that should earn
 * none. `calculate_quote` does not itself decide whether a volume can be fulfilled — that is
 * `lookup_inventory`'s job — but it must never let an undefined proportion read as "buying
 * everything we have," so the conservative answer here is no discount at all.
 */
function discountRateFor(requestedVolume: number, availableVolume: number): number {
  if (availableVolume <= 0) return 0;
  const proportion = requestedVolume / availableVolume;
  if (proportion >= 0.8) return 0.15;
  if (proportion >= 0.5) return 0.1;
  if (proportion >= 0.25) return 0.05;
  return 0;
}

function priceLineItem(pkg: RateCardPackageData, requestedVolume: number): PricedLineItem {
  // The subtotal rounds to the nearest cent — an ordinary, unbiased price, not a discount, so
  // there is no reason to favour either side of it. The discount below floors instead: rounding
  // a discount up would mean occasionally giving away more margin than the tier actually earns,
  // where rounding a price up or down by half a cent is just how prices work.
  const subtotalCents =
    pkg.pricingUnit === 'PER_THOUSAND'
      ? Math.round((pkg.unitPriceCents * requestedVolume) / 1000)
      : pkg.unitPriceCents * requestedVolume;

  const discountCents = Math.floor(
    subtotalCents * discountRateFor(requestedVolume, pkg.availableVolume),
  );

  return {
    packageId: pkg.id,
    requestedVolume,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

export function calculateQuote(
  packages: readonly RateCardPackageData[],
  lineItems: readonly QuoteLineItem[],
): QuoteResult {
  const priced: PricedLineItem[] = [];

  for (const item of lineItems) {
    const pkg = packages.find((p) => p.id === item.packageId);
    if (!pkg) {
      return { ok: false, reason: 'PACKAGE_NOT_FOUND', packageId: item.packageId };
    }
    priced.push(priceLineItem(pkg, item.requestedVolume));
  }

  const subtotalCents = priced.reduce((sum, item) => sum + item.subtotalCents, 0);
  const discountCents = priced.reduce((sum, item) => sum + item.discountCents, 0);

  return {
    ok: true,
    data: {
      lineItems: priced,
      subtotalCents,
      discountCents,
      totalCents: subtotalCents - discountCents,
    },
  };
}

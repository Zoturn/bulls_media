import { calculateQuote } from './quote';
import type { RateCardPackageData } from './rateCardSearch';

// availableVolume of exactly 1,000,000 makes the discount-tier percentages land on round numbers.
const PER_THOUSAND_PKG: RateCardPackageData = {
  id: 'pkg-thousand',
  name: 'Test CPM Package',
  channel: 'display',
  format: 'test',
  unitPriceCents: 1_000, // $10 CPM
  pricingUnit: 'PER_THOUSAND',
  availableVolume: 1_000_000,
  minFlightDays: 1,
  maxFlightDays: 30,
};

// availableVolume of 40 mirrors the seeded newsletter package's actual shape.
const PER_UNIT_PKG: RateCardPackageData = {
  id: 'pkg-unit',
  name: 'Test Per-Send Package',
  channel: 'newsletter',
  format: 'test',
  unitPriceCents: 12_000,
  pricingUnit: 'PER_UNIT',
  availableVolume: 40,
  minFlightDays: 1,
  maxFlightDays: 30,
};

// A sold-out package — availableVolume: 0 is a valid value the schema allows (nonnegative, not
// strictly positive), and this is exactly the shape a real inventory hits once it sells through.
const SOLD_OUT_PKG: RateCardPackageData = {
  id: 'pkg-sold-out',
  name: 'Sold Out Package',
  channel: 'display',
  format: 'test',
  unitPriceCents: 1_000,
  pricingUnit: 'PER_THOUSAND',
  availableVolume: 0,
  minFlightDays: 1,
  maxFlightDays: 30,
};

const PACKAGES = [PER_THOUSAND_PKG, PER_UNIT_PKG, SOLD_OUT_PKG];

describe('calculateQuote', () => {
  it('applies no discount below the first tier (24%)', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 240_000 },
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        lineItems: [
          {
            packageId: 'pkg-thousand',
            requestedVolume: 240_000,
            subtotalCents: 240_000,
            discountCents: 0,
            totalCents: 240_000,
          },
        ],
        subtotalCents: 240_000,
        discountCents: 0,
        totalCents: 240_000,
      },
    });
  });

  it('applies the 5% tier exactly at the 25% boundary', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 250_000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalCents).toBe(237_500);
    expect(result.data.discountCents).toBe(12_500);
  });

  it('stays in the 5% tier just below the 50% boundary (49%)', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 490_000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.discountCents).toBe(24_500);
    expect(result.data.totalCents).toBe(465_500);
  });

  it('applies the 10% tier exactly at the 50% boundary', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 500_000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.discountCents).toBe(50_000);
    expect(result.data.totalCents).toBe(450_000);
  });

  it('stays in the 10% tier just below the 80% boundary (79%)', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 790_000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.discountCents).toBe(79_000);
    expect(result.data.totalCents).toBe(711_000);
  });

  it('applies the 15% tier exactly at the 80% boundary', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 800_000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.discountCents).toBe(120_000);
    expect(result.data.totalCents).toBe(680_000);
  });

  it('prices a PER_UNIT package without dividing by 1000', () => {
    const result = calculateQuote(PACKAGES, [{ packageId: 'pkg-unit', requestedVolume: 5 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 5 of 40 = 12.5%, below the first discount tier.
    expect(result.data.subtotalCents).toBe(60_000);
    expect(result.data.discountCents).toBe(0);
    expect(result.data.totalCents).toBe(60_000);
  });

  it("applies a PER_UNIT package's own discount tier independently", () => {
    const result = calculateQuote(PACKAGES, [{ packageId: 'pkg-unit', requestedVolume: 10 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 10 of 40 = 25%, the 5% tier.
    expect(result.data.subtotalCents).toBe(120_000);
    expect(result.data.discountCents).toBe(6_000);
    expect(result.data.totalCents).toBe(114_000);
  });

  it('sums multiple line items, each discounted independently by its own volume', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 100_000 }, // 10% of avail, no discount
      { packageId: 'pkg-unit', requestedVolume: 15 }, // 37.5% of avail, the 5% tier
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lineItems).toHaveLength(2);
    // pkg-thousand: 1000 * 100 = 100,000, no discount.
    // pkg-unit: 12000 * 15 = 180,000, 5% discount = 9,000.
    expect(result.data.subtotalCents).toBe(280_000);
    expect(result.data.discountCents).toBe(9_000);
    expect(result.data.totalCents).toBe(271_000);
  });

  it('fails naming the offending package id and computes no partial total', () => {
    const result = calculateQuote(PACKAGES, [
      { packageId: 'pkg-thousand', requestedVolume: 100_000 },
      { packageId: 'does-not-exist', requestedVolume: 10 },
    ]);
    expect(result).toEqual({ ok: false, reason: 'PACKAGE_NOT_FOUND', packageId: 'does-not-exist' });
  });

  it('produces byte-identical output for the same input on repeated calls', () => {
    const input = [{ packageId: 'pkg-thousand', requestedVolume: 333_333 }];
    const first = calculateQuote(PACKAGES, input);
    const second = calculateQuote(PACKAGES, input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('applies no discount to a sold-out package, rather than dividing by zero', () => {
    // Regression: requestedVolume / availableVolume with availableVolume === 0 evaluates to
    // Infinity, which satisfied every discount-tier threshold and silently granted 15% off a
    // package with nothing available to sell.
    const result = calculateQuote(PACKAGES, [{ packageId: 'pkg-sold-out', requestedVolume: 100 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.discountCents).toBe(0);
    expect(result.data.totalCents).toBe(result.data.subtotalCents);
    expect(Number.isFinite(result.data.totalCents)).toBe(true);
  });
});

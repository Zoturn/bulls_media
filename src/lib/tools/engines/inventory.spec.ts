import { checkInventory } from './inventory';
import type { RateCardPackageData } from './rateCardSearch';

const PACKAGES: RateCardPackageData[] = [
  {
    id: 'rate-display-ros',
    name: 'Run of Site Display',
    channel: 'display',
    format: '300x250',
    unitPriceCents: 800,
    pricingUnit: 'PER_THOUSAND',
    availableVolume: 5_000_000,
    minFlightDays: 7,
    maxFlightDays: 90,
  },
];

describe('checkInventory', () => {
  it('reports available when the requested volume is at the available ceiling', () => {
    const result = checkInventory(PACKAGES, 'rate-display-ros', 5_000_000);
    expect(result).toEqual({
      ok: true,
      data: { status: 'AVAILABLE', packageId: 'rate-display-ros', availableVolume: 5_000_000 },
    });
  });

  it('reports available when the requested volume is below the ceiling', () => {
    const result = checkInventory(PACKAGES, 'rate-display-ros', 1_000_000);
    expect(result).toEqual({
      ok: true,
      data: { status: 'AVAILABLE', packageId: 'rate-display-ros', availableVolume: 5_000_000 },
    });
  });

  it('reports insufficient, stating the actual available volume, one unit over the ceiling', () => {
    const result = checkInventory(PACKAGES, 'rate-display-ros', 5_000_001);
    expect(result).toEqual({
      ok: true,
      data: {
        status: 'INSUFFICIENT',
        packageId: 'rate-display-ros',
        requestedVolume: 5_000_001,
        availableVolume: 5_000_000,
      },
    });
  });

  it('reports package-not-found distinctly from zero availability', () => {
    const result = checkInventory(PACKAGES, 'does-not-exist', 100);
    expect(result).toEqual({ ok: false, reason: 'PACKAGE_NOT_FOUND', packageId: 'does-not-exist' });
  });
});

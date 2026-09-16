import type { RateCardPackageData } from './rateCardSearch';

/**
 * Confirms availability for one specific package — the number `calculate_quote` is allowed to
 * rely on. Distinct from `search_rate_card`'s browsing results: see
 * openspec/changes/add-agent-tools/design.md on why the two stay separate tools.
 */

export type InventoryCheck =
  | { ok: true; data: { status: 'AVAILABLE'; packageId: string; availableVolume: number } }
  | {
      ok: true;
      data: {
        status: 'INSUFFICIENT';
        packageId: string;
        requestedVolume: number;
        availableVolume: number;
      };
    }
  | { ok: false; reason: 'PACKAGE_NOT_FOUND'; packageId: string };

export function checkInventory(
  packages: readonly RateCardPackageData[],
  packageId: string,
  requestedVolume: number,
): InventoryCheck {
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg) {
    return { ok: false, reason: 'PACKAGE_NOT_FOUND', packageId };
  }

  if (requestedVolume > pkg.availableVolume) {
    return {
      ok: true,
      data: {
        status: 'INSUFFICIENT',
        packageId,
        requestedVolume,
        availableVolume: pkg.availableVolume,
      },
    };
  }

  return {
    ok: true,
    data: { status: 'AVAILABLE', packageId, availableVolume: pkg.availableVolume },
  };
}

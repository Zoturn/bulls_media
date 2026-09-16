import { POLICY_RULES, RATE_CARD } from '../../../prisma/seed-data';
import { policyDecisionSchema, rateCardChannelSchema, rateCardPricingUnitSchema } from './enums';

/**
 * These enums exist to catch exactly this kind of drift: a value written into seeded data (or,
 * later, into a tool's output) that the shared type doesn't recognise. Cross-checking the seed
 * fixtures here means a typo in either place fails immediately, rather than only once some later
 * change starts actually branching on these values.
 */
describe('domain enums', () => {
  it('accepts every seeded policy decision', () => {
    for (const rule of POLICY_RULES) {
      expect(policyDecisionSchema.safeParse(rule.decision).success).toBe(true);
    }
  });

  it('accepts every seeded rate-card channel', () => {
    for (const pkg of RATE_CARD) {
      expect(rateCardChannelSchema.safeParse(pkg.channel).success).toBe(true);
    }
  });

  it('rejects a value outside the policy decision enum', () => {
    expect(policyDecisionSchema.safeParse('MAYBE').success).toBe(false);
  });

  it('rejects a value outside the rate-card channel enum', () => {
    expect(rateCardChannelSchema.safeParse('print').success).toBe(false);
  });

  it('accepts every seeded rate-card pricing unit', () => {
    for (const pkg of RATE_CARD) {
      expect(rateCardPricingUnitSchema.safeParse(pkg.pricingUnit).success).toBe(true);
    }
  });

  it('rejects a value outside the rate-card pricing unit enum', () => {
    expect(rateCardPricingUnitSchema.safeParse('PER_IMPRESSION').success).toBe(false);
  });
});

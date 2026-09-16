import { POLICY_RULES, RATE_CARD, SEED } from './seed-data';

describe('seed fixtures', () => {
  it('exposes every documented message fixture by key', () => {
    const keys = Object.keys(SEED.messages);

    expect(keys).toEqual([
      'ordinaryBrief',
      'prohibitedVertical',
      'reviewVertical',
      'injectionAttempt',
      'notABrief',
      'missingBudget',
    ]);
  });

  it('gives every message a unique, non-empty id', () => {
    const ids = Object.values(SEED.messages).map((m) => m.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('includes the injection-attempt fixture, identifiable by id', () => {
    expect(SEED.messages.injectionAttempt.id).toBe('msg-injection-attempt');
    // The body must actually carry an instruction addressed to the agent — that's the point of
    // this fixture, and a future edit that waters it down should fail this test.
    expect(SEED.messages.injectionAttempt.body.toLowerCase()).toMatch(
      /ignore your previous instructions/,
    );
  });

  it('includes a prohibited-vertical fixture matching a REFUSE policy rule', () => {
    const gamblingRule = POLICY_RULES.find((r) => r.vertical === 'gambling');

    expect(gamblingRule?.decision).toBe('REFUSE');
    expect(SEED.messages.prohibitedVertical.body.toLowerCase()).toMatch(/casino|betting/);
  });

  it('includes a review-vertical fixture matching a REVIEW policy rule', () => {
    const cryptoRule = POLICY_RULES.find((r) => r.vertical === 'cryptocurrency');

    expect(cryptoRule?.decision).toBe('REVIEW');
    expect(SEED.messages.reviewVertical.body.toLowerCase()).toMatch(/crypto/);
  });

  it('includes a non-brief fixture with no advertising or budget language', () => {
    expect(SEED.messages.notABrief.body.toLowerCase()).not.toMatch(/budget|campaign|advertis/);
  });

  it('includes a missing-budget fixture that never states a number', () => {
    expect(SEED.messages.missingBudget.body).not.toMatch(/\$[\d,]+/);
  });

  it('gives every rate-card package a unique id and a positive price and volume', () => {
    const ids = RATE_CARD.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const pkg of RATE_CARD) {
      expect(pkg.unitPriceCents).toBeGreaterThan(0);
      expect(pkg.availableVolume).toBeGreaterThan(0);
      expect(pkg.minFlightDays).toBeLessThanOrEqual(pkg.maxFlightDays);
    }
  });

  it('covers all four channels in the rate card', () => {
    const channels = new Set(RATE_CARD.map((p) => p.channel));
    expect(channels).toEqual(new Set(['display', 'video', 'audio', 'newsletter']));
  });

  it('gives every rate-card package a valid pricing unit, matching its channel', () => {
    for (const pkg of RATE_CARD) {
      expect(['PER_THOUSAND', 'PER_UNIT']).toContain(pkg.pricingUnit);
      // Newsletter is priced per send, not per 1,000 sends — every other seeded channel is
      // impression/play volume, priced per 1,000. A future package breaking this pattern is fine;
      // this test only pins today's fixtures, not a rule about channels in general.
      expect(pkg.pricingUnit).toBe(pkg.channel === 'newsletter' ? 'PER_UNIT' : 'PER_THOUSAND');
    }
  });

  it('gives every policy rule a unique id and a valid decision', () => {
    const ids = POLICY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const rule of POLICY_RULES) {
      expect(['ALLOW', 'REVIEW', 'REFUSE']).toContain(rule.decision);
    }
  });

  it('includes at least one REFUSE and one REVIEW policy rule', () => {
    const decisions = POLICY_RULES.map((r) => r.decision);
    expect(decisions).toContain('REFUSE');
    expect(decisions).toContain('REVIEW');
  });
});

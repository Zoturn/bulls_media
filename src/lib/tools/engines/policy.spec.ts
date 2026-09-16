import { matchPolicy, type PolicyRuleData } from './policy';

const RULES: PolicyRuleData[] = [
  { id: 'policy-gambling', vertical: 'gambling', decision: 'REFUSE', description: 'No gambling.' },
  {
    id: 'policy-crypto',
    vertical: 'cryptocurrency',
    decision: 'REVIEW',
    description: 'Needs review.',
  },
  { id: 'policy-general', vertical: 'general', decision: 'ALLOW', description: 'Standard terms.' },
];

describe('matchPolicy', () => {
  it('matches a seeded vertical exactly', () => {
    const result = matchPolicy(RULES, 'gambling');
    expect(result.data.decision).toBe('REFUSE');
    expect(result.data.ruleId).toBe('policy-gambling');
    expect(result.data.matchedVertical).toBe(true);
  });

  it('matches regardless of case', () => {
    expect(matchPolicy(RULES, 'GAMBLING').data.ruleId).toBe('policy-gambling');
    expect(matchPolicy(RULES, 'Gambling').data.ruleId).toBe('policy-gambling');
  });

  it('falls back to the general rule for an unrecognised vertical', () => {
    const result = matchPolicy(RULES, 'artisanal cheese');
    expect(result.data.decision).toBe('ALLOW');
    expect(result.data.ruleId).toBe('policy-general');
    expect(result.data.matchedVertical).toBe(false);
  });

  it('fails closed with REFUSE when even the general rule is missing', () => {
    const rulesWithNoFallback = RULES.filter((r) => r.vertical !== 'general');
    const result = matchPolicy(rulesWithNoFallback, 'artisanal cheese');
    expect(result.data.decision).toBe('REFUSE');
    expect(result.data.ruleId).toBeNull();
    expect(result.data.matchedVertical).toBe(false);
  });

  it('never throws for an empty rule set', () => {
    expect(() => matchPolicy([], 'anything')).not.toThrow();
    expect(matchPolicy([], 'anything').data.decision).toBe('REFUSE');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(matchPolicy(RULES, '  gambling  ').data.ruleId).toBe('policy-gambling');
  });
});

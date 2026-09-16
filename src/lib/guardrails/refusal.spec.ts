import type { RecordedToolResult } from '@/lib/agent/phases';
import { policyResult as policy } from '@/lib/testing/toolResults';
import { describeRefusal, enforcedStatusFor, refusalEvidence } from './refusal';

describe('enforcedStatusFor', () => {
  it('refuses whatever the model claimed, once a REFUSE is on record', () => {
    const history = [policy('REFUSE', 'gambling')];
    for (const disposition of [
      'QUOTED',
      'REFUSED',
      'NEEDS_INFO',
      'NEEDS_REVIEW',
      'NOT_A_BRIEF',
    ] as const) {
      expect(enforcedStatusFor(history, disposition)).toBe('REFUSED');
    }
  });

  it('maps the disposition normally when nothing refused', () => {
    const history = [policy('ALLOW', 'automotive')];
    expect(enforcedStatusFor(history, 'QUOTED')).toBe('COMPLETED');
    expect(enforcedStatusFor(history, 'NEEDS_REVIEW')).toBe('NEEDS_HUMAN');
    expect(enforcedStatusFor(history, 'NOT_A_BRIEF')).toBe('COMPLETED');
  });

  it('still refuses when a later check came back clean', () => {
    // Refusal is a fact about the run, not about the most recent decision.
    const history = [policy('REFUSE', 'gambling'), policy('ALLOW', 'retail')];
    expect(enforcedStatusFor(history, 'QUOTED')).toBe('REFUSED');
  });

  it('does not refuse on an empty history', () => {
    expect(enforcedStatusFor([], 'NOT_A_BRIEF')).toBe('COMPLETED');
  });

  it('refuses even when the model produced no disposition at all', () => {
    // A refused enquiry whose model then burned its step budget has still been refused. Closing
    // it FAILED would present a settled policy decision as something to retry.
    expect(enforcedStatusFor([policy('REFUSE', 'gambling')], undefined)).toBe('REFUSED');
  });

  it('fails when nothing was decided and nothing refused', () => {
    expect(enforcedStatusFor([policy('ALLOW', 'automotive')], undefined)).toBe('FAILED');
    expect(enforcedStatusFor([], undefined)).toBe('FAILED');
  });

  it('ignores a fabricated result that is not a real policy output', () => {
    const fabricated: RecordedToolResult = {
      toolName: 'check_ad_policy',
      input: { vertical: 'gambling' },
      output: { decision: 'REFUSE' }, // not the tool's shape
    };
    expect(enforcedStatusFor([fabricated], 'QUOTED')).toBe('COMPLETED');
  });
});

describe('refusalEvidence', () => {
  it('names the rule and the vertical the tool was actually asked about', () => {
    const evidence = refusalEvidence([policy('REFUSE', 'gambling')]);
    expect(evidence).toMatchObject({ ruleId: 'policy-gambling', vertical: 'gambling' });
  });

  it('takes the first refusal, which is the one that took effect', () => {
    const history = [policy('REFUSE', 'gambling'), policy('REFUSE', 'tobacco')];
    expect(refusalEvidence(history)?.vertical).toBe('gambling');
  });

  it('is undefined when nothing refused', () => {
    expect(refusalEvidence([policy('ALLOW', 'automotive')])).toBeUndefined();
    expect(refusalEvidence([])).toBeUndefined();
  });

  it('copes with a refusal whose recorded input is missing', () => {
    const noInput: RecordedToolResult = { ...policy('REFUSE', 'gambling'), input: undefined };
    expect(refusalEvidence([noInput])?.vertical).toBe('an unrecorded vertical');
  });
});

describe('describeRefusal', () => {
  it('says which rule refused and about what', () => {
    const evidence = refusalEvidence([policy('REFUSE', 'gambling')]);
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;

    const described = describeRefusal(evidence);
    expect(described).toContain('policy-gambling');
    expect(described).toContain('gambling');
  });

  it('still reads sensibly for the fallback rule', () => {
    const evidence = refusalEvidence([policy('REFUSE', 'something novel', null)]);
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(describeRefusal(evidence)).toContain('the default policy');
  });
});

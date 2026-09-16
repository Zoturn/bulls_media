import type { RecordedToolResult } from '@/lib/agent/phases';
import {
  failedQuoteResult,
  policyResult as policy,
  quoteResult as quote,
} from '@/lib/testing/toolResults';
import {
  checkPostConditions,
  describeViolations,
  type AssessmentClaim,
  type PostConditionCheck,
} from './postconditions';

/**
 * The checks on their own: plain claims, plain histories, no run and no database. That is the
 * point of them being pure — the whole matrix is a table, and every one of these cases would cost
 * a scripted model run to express anywhere else.
 */

const checksFor = (claim: AssessmentClaim, history: RecordedToolResult[]): PostConditionCheck[] =>
  checkPostConditions(claim, history).map((violation) => violation.check);

describe('a quoted claim', () => {
  it('passes when the total is one calculate_quote returned', () => {
    const history = [policy('ALLOW', 'automotive'), quote(800_000)];
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 800_000 }, history)).toEqual([]);
  });

  it('fails when the total is not', () => {
    const history = [policy('ALLOW', 'automotive'), quote(800_000)];
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 800_001 }, history)).toEqual([
      'QUOTE_TOTAL_MATCHES_CALCULATION',
    ]);
  });

  it('fails when it carries no total at all', () => {
    const history = [policy('ALLOW', 'automotive'), quote(800_000)];
    expect(checksFor({ disposition: 'QUOTED' }, history)).toEqual([
      'QUOTE_TOTAL_MATCHES_CALCULATION',
    ]);
  });

  it('fails when calculate_quote never ran', () => {
    expect(
      checksFor({ disposition: 'QUOTED', quoteCents: 800_000 }, [policy('ALLOW', 'automotive')]),
    ).toEqual(['QUOTE_HAS_A_CALCULATION']);
  });

  it('does not count a failed calculation as a calculation', () => {
    const history = [policy('ALLOW', 'automotive'), failedQuoteResult()];
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 800_000 }, history)).toEqual([
      'QUOTE_HAS_A_CALCULATION',
    ]);
  });

  it('accepts any total the tool returned, not only the most recent', () => {
    // A model that revises after an inventory shortfall legitimately produces several. See this
    // change's design.md on why the looser rule plus the full trace is the choice made here.
    const history = [policy('ALLOW', 'automotive'), quote(800_000), quote(400_000)];
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 800_000 }, history)).toEqual([]);
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 400_000 }, history)).toEqual([]);
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 600_000 }, history)).toEqual([
      'QUOTE_TOTAL_MATCHES_CALCULATION',
    ]);
  });

  it('is not fooled by a fabricated tool result', () => {
    const fabricated: RecordedToolResult = {
      toolName: 'calculate_quote',
      input: {},
      output: { ok: true, data: { totalCents: 1 } }, // missing everything the real schema requires
    };
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 1 }, [fabricated])).toEqual([
      'QUOTE_HAS_A_CALCULATION',
    ]);
  });
});

describe('a refused claim', () => {
  it('passes when it carries no quote', () => {
    expect(checksFor({ disposition: 'REFUSED' }, [policy('REFUSE', 'gambling')])).toEqual([]);
  });

  it('fails when it carries one', () => {
    expect(
      checksFor({ disposition: 'REFUSED', quoteCents: 500_000 }, [policy('REFUSE', 'gambling')]),
    ).toEqual(['REFUSAL_CARRIES_NO_QUOTE']);
  });
});

describe('the vertical', () => {
  it('passes when it is one policy was asked about', () => {
    const history = [policy('ALLOW', 'automotive')];
    expect(checksFor({ disposition: 'NEEDS_INFO', vertical: 'automotive' }, history)).toEqual([]);
  });

  it('ignores case and surrounding space, as the tool itself does', () => {
    const history = [policy('ALLOW', 'automotive')];
    expect(checksFor({ disposition: 'NEEDS_INFO', vertical: '  Automotive ' }, history)).toEqual(
      [],
    );
  });

  it('fails when policy was asked about something else', () => {
    const history = [policy('ALLOW', 'automotive')];
    expect(checksFor({ disposition: 'NEEDS_INFO', vertical: 'gambling' }, history)).toEqual([
      'VERTICAL_WAS_ASSESSED',
    ]);
  });

  it('fails when policy was never called', () => {
    expect(checksFor({ disposition: 'NEEDS_INFO', vertical: 'automotive' }, [])).toEqual([
      'VERTICAL_WAS_ASSESSED',
    ]);
  });

  it('is not checked when the assessment extracted no brief', () => {
    expect(checksFor({ disposition: 'NOT_A_BRIEF' }, [])).toEqual([]);
  });
});

describe('the disposition against the policy decision', () => {
  it('fails any disposition but REFUSED once a REFUSE is on record', () => {
    for (const disposition of ['QUOTED', 'NEEDS_INFO', 'NEEDS_REVIEW', 'NOT_A_BRIEF'] as const) {
      expect(checksFor({ disposition }, [policy('REFUSE', 'gambling')])).toContain(
        'DISPOSITION_MATCHES_POLICY',
      );
    }
  });

  it('passes REFUSED', () => {
    expect(checksFor({ disposition: 'REFUSED' }, [policy('REFUSE', 'gambling')])).toEqual([]);
  });

  it('does not fire on ALLOW or REVIEW', () => {
    expect(
      checksFor({ disposition: 'QUOTED', quoteCents: 1 }, [policy('ALLOW', 'retail'), quote(1)]),
    ).toEqual([]);
    expect(
      checksFor({ disposition: 'NEEDS_REVIEW' }, [policy('REVIEW', 'cryptocurrency')]),
    ).toEqual([]);
  });

  it('fires on a refusal recorded at any point, not only the most recent decision', () => {
    const history = [policy('REFUSE', 'gambling'), policy('ALLOW', 'retail')];
    expect(checksFor({ disposition: 'QUOTED', quoteCents: 1 }, history)).toContain(
      'DISPOSITION_MATCHES_POLICY',
    );
  });
});

describe('an empty history', () => {
  it('raises nothing for a claim that asserts nothing checkable', () => {
    expect(checksFor({ disposition: 'NOT_A_BRIEF' }, [])).toEqual([]);
  });
});

describe('describeViolations', () => {
  it('names the check, the claim and what was recorded instead', () => {
    const violations = checkPostConditions({ disposition: 'QUOTED', quoteCents: 12 }, [
      policy('ALLOW', 'automotive'),
      quote(800_000),
    ]);
    const described = describeViolations(violations);
    expect(described).toContain('QUOTE_TOTAL_MATCHES_CALCULATION');
    expect(described).toContain('12');
    expect(described).toContain('800000');
  });

  it('is empty for no violations', () => {
    expect(describeViolations([])).toBe('');
  });
});

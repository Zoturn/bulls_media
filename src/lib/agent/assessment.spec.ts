import { ASSESSMENT_DISPOSITIONS } from '@/lib/domain/enums';
import { assessmentSchema, dispositionToRunStatus, type Assessment } from './assessment';

const brief = {
  advertiser: 'North Road Autos',
  vertical: 'automotive',
  channel: 'display' as const,
  budgetCents: 1_800_000,
  requestedVolume: 1_000_000,
  flightDays: 30,
};

const quoted = {
  summary: 'Quoted.',
  outcome: {
    disposition: 'QUOTED',
    brief,
    quote: {
      lineItems: [
        { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 7_600_000 },
      ],
      totalCents: 7_600_000,
    },
    draftReply: 'Here are the options.',
  },
} satisfies Assessment;

describe('dispositionToRunStatus', () => {
  it.each([
    ['QUOTED', 'COMPLETED'],
    ['NEEDS_INFO', 'COMPLETED'],
    ['NOT_A_BRIEF', 'COMPLETED'],
    ['REFUSED', 'REFUSED'],
    ['NEEDS_REVIEW', 'NEEDS_HUMAN'],
  ] as const)('maps %s to %s', (disposition, status) => {
    expect(dispositionToRunStatus(disposition)).toBe(status);
  });

  it('covers every disposition the domain defines', () => {
    // The `never` check inside makes this a compile-time guarantee too; this asserts that the
    // schema's set and the domain enum's set have not drifted apart.
    for (const disposition of ASSESSMENT_DISPOSITIONS) {
      expect(() => dispositionToRunStatus(disposition)).not.toThrow();
    }
  });

  it('never returns RUNNING', () => {
    const statuses = ASSESSMENT_DISPOSITIONS.map(dispositionToRunStatus);
    expect(statuses).not.toContain('RUNNING');
  });
});

describe('assessmentSchema', () => {
  it('accepts a complete quoted assessment', () => {
    expect(assessmentSchema.safeParse(quoted).success).toBe(true);
  });

  it('strips a quote off a refused assessment rather than carrying it through', () => {
    const refusedWithQuote = {
      summary: 'Refused.',
      outcome: {
        disposition: 'REFUSED',
        brief,
        refusalReason: 'Gambling is not accepted.',
        quote: quoted.outcome.quote,
      },
    };
    const parsed = assessmentSchema.safeParse(refusedWithQuote);
    // The variant has no `quote`, so the field is dropped rather than persisted as a price.
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'quote' in parsed.data.outcome).toBe(false);
  });

  it('rejects a quoted assessment with no total', () => {
    const noTotal = {
      summary: 'Quoted.',
      outcome: { disposition: 'QUOTED', brief, draftReply: 'Here you go.' },
    };
    expect(assessmentSchema.safeParse(noTotal).success).toBe(false);
  });

  it('rejects a refusal with no reason', () => {
    const noReason = { summary: 'Refused.', outcome: { disposition: 'REFUSED', brief } };
    expect(assessmentSchema.safeParse(noReason).success).toBe(false);
  });

  it('rejects a disposition outside the domain', () => {
    const bogus = { summary: 'Done.', outcome: { disposition: 'APPROVED', brief } };
    expect(assessmentSchema.safeParse(bogus).success).toBe(false);
  });

  it('rejects an empty summary', () => {
    expect(assessmentSchema.safeParse({ ...quoted, summary: '' }).success).toBe(false);
  });

  it('accepts a not-a-brief outcome with no brief at all', () => {
    const notABrief = {
      summary: 'This is an invoice query.',
      outcome: { disposition: 'NOT_A_BRIEF' },
    };
    expect(assessmentSchema.safeParse(notABrief).success).toBe(true);
  });

  it('round-trips through JSON unchanged, since that is how it reaches the database', () => {
    const parsed = assessmentSchema.parse(JSON.parse(JSON.stringify(quoted)));
    expect(parsed).toEqual(quoted);
  });
});

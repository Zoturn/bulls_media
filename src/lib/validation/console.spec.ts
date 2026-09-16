import type { InboxRow, CaseDetailRow } from '@/lib/services/consoleReads';
import {
  approvalRequestSchema,
  openCaseRequestSchema,
  toCaseDetail,
  toInboxEntry,
} from './console';

/**
 * The DTO builders on their own: a plain object shaped like a `consoleReads` row in, a
 * schema-valid DTO out. Each builder ends with `.parse()`, so a shape mistake here fails loudly
 * in this spec rather than silently reaching an API response.
 */

describe('toInboxEntry', () => {
  it('renders a message with no case as case: null', () => {
    const row: InboxRow = {
      id: 'msg-1',
      fromName: 'Alex',
      fromAddress: 'alex@example.test',
      subject: 'Hello',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      case: null,
    };

    expect(toInboxEntry(row)).toEqual({
      messageId: 'msg-1',
      fromName: 'Alex',
      fromAddress: 'alex@example.test',
      subject: 'Hello',
      receivedAt: '2026-01-01T00:00:00.000Z',
      case: null,
    });
  });

  it('renders a case with no run as latestRunStatus: null', () => {
    const row: InboxRow = {
      id: 'msg-2',
      fromName: 'Alex',
      fromAddress: 'alex@example.test',
      subject: 'Hello',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      case: { id: 'case-1', status: 'OPEN', runs: [] },
    };

    expect(toInboxEntry(row).case).toEqual({ id: 'case-1', status: 'OPEN', latestRunStatus: null });
  });

  it('renders the latest run status when one exists', () => {
    const row: InboxRow = {
      id: 'msg-3',
      fromName: 'Alex',
      fromAddress: 'alex@example.test',
      subject: 'Hello',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      case: { id: 'case-1', status: 'OPEN', runs: [{ status: 'RUNNING' }] },
    };

    expect(toInboxEntry(row).case?.latestRunStatus).toBe('RUNNING');
  });
});

function baseCaseRow(overrides: Partial<CaseDetailRow['runs'][number]> = {}): CaseDetailRow {
  return {
    id: 'case-1',
    status: 'OPEN',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    inboundMessage: {
      id: 'msg-1',
      fromName: 'Alex',
      fromAddress: 'alex@example.test',
      subject: 'Hello',
      body: 'Body',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    runs: [
      {
        id: 'run-1',
        status: 'RUNNING',
        modelId: 'mock-model',
        promptVersion: 'v1',
        maxSteps: 12,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        finishedAt: null,
        totalTokens: null,
        errorMessage: null,
        steps: [],
        assessment: null,
        approval: null,
        ...overrides,
      },
    ],
  };
}

describe('toCaseDetail', () => {
  it('renders a case with no run at all', () => {
    const row = baseCaseRow();
    row.runs = [];

    expect(toCaseDetail(row).latestRun).toBeNull();
  });

  it('renders a run with no steps, no assessment, no approval', () => {
    const detail = toCaseDetail(baseCaseRow());
    expect(detail.latestRun).toMatchObject({
      status: 'RUNNING',
      steps: [],
      assessment: null,
      approval: null,
    });
    expect(detail.latestRun?.diagnostics).toBeNull();
  });

  it('converts every date field to an ISO string', () => {
    const detail = toCaseDetail(baseCaseRow());
    expect(detail.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(detail.message.receivedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(detail.latestRun?.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('renders steps and converts their dates too', () => {
    const detail = toCaseDetail(
      baseCaseRow({
        steps: [
          {
            id: 'step-1',
            index: 0,
            type: 'MODEL_CALL',
            toolName: null,
            input: null,
            output: '{}',
            error: null,
            durationMs: 10,
            tokens: 50,
            createdAt: new Date('2026-01-01T00:01:00.000Z'),
          },
        ],
      }),
    );

    expect(detail.latestRun?.steps).toEqual([
      {
        id: 'step-1',
        index: 0,
        type: 'MODEL_CALL',
        toolName: null,
        input: null,
        output: '{}',
        error: null,
        durationMs: 10,
        tokens: 50,
        createdAt: '2026-01-01T00:01:00.000Z',
      },
    ]);
  });

  it('renders an assessment and an undecided approval', () => {
    const detail = toCaseDetail(
      baseCaseRow({
        status: 'COMPLETED',
        finishedAt: new Date('2026-01-01T00:05:00.000Z'),
        assessment: {
          id: 'assessment-1',
          disposition: 'QUOTED',
          summary: 'Priced.',
          structured: '{}',
          refusalReason: null,
          quoteCents: 500_000,
          draftReply: 'Here you go.',
          createdAt: new Date('2026-01-01T00:04:00.000Z'),
        },
        approval: null,
      }),
    );

    expect(detail.latestRun?.finishedAt).toBe('2026-01-01T00:05:00.000Z');
    expect(detail.latestRun?.assessment).toEqual({
      id: 'assessment-1',
      disposition: 'QUOTED',
      summary: 'Priced.',
      structured: '{}',
      refusalReason: null,
      quoteCents: 500_000,
      draftReply: 'Here you go.',
      createdAt: '2026-01-01T00:04:00.000Z',
    });
  });

  it('renders a decided approval, converting decidedAt', () => {
    const detail = toCaseDetail(
      baseCaseRow({
        approval: {
          id: 'approval-1',
          decision: 'APPROVED',
          decidedBy: 'Jordan',
          decidedAt: new Date('2026-01-01T00:06:00.000Z'),
          note: 'Looks right',
        },
      }),
    );

    expect(detail.latestRun?.approval).toEqual({
      id: 'approval-1',
      decision: 'APPROVED',
      decidedBy: 'Jordan',
      decidedAt: '2026-01-01T00:06:00.000Z',
      note: 'Looks right',
    });
  });

  describe('diagnostics', () => {
    function withTerminalOutput(output: string) {
      return baseCaseRow({
        steps: [
          {
            id: 'step-terminal',
            index: 0,
            type: 'TERMINAL',
            toolName: null,
            input: null,
            output,
            error: null,
            durationMs: 0,
            tokens: null,
            createdAt: new Date('2026-01-01T00:01:00.000Z'),
          },
        ],
      });
    }

    it('parses a well-formed terminal payload', () => {
      const detail = toCaseDetail(
        withTerminalOutput(JSON.stringify({ status: 'REFUSED', phase: 'PERSIST' })),
      );
      expect(detail.latestRun?.diagnostics).toEqual({ status: 'REFUSED', phase: 'PERSIST' });
    });

    it('includes refusal evidence and violations when present', () => {
      const payload = {
        status: 'REFUSED',
        phase: 'PERSIST',
        refusal: { ruleId: 'policy-gambling', vertical: 'gambling', description: 'No gambling.' },
        refusalSummary: 'Refused by policy-gambling for the vertical "gambling".',
        violations: [{ check: 'QUOTE_HAS_A_CALCULATION', claimed: 'a quote', recorded: 'nothing' }],
      };
      const detail = toCaseDetail(withTerminalOutput(JSON.stringify(payload)));
      expect(detail.latestRun?.diagnostics).toEqual(payload);
    });

    it('is null when there is no TERMINAL step yet', () => {
      expect(toCaseDetail(baseCaseRow()).latestRun?.diagnostics).toBeNull();
    });

    it('is null when the TERMINAL step output is not valid JSON', () => {
      expect(toCaseDetail(withTerminalOutput('not json')).latestRun?.diagnostics).toBeNull();
    });

    it('is null when the TERMINAL step output does not match the schema', () => {
      expect(
        toCaseDetail(withTerminalOutput(JSON.stringify({ nothing: 'useful' }))).latestRun
          ?.diagnostics,
      ).toBeNull();
    });
  });
});

describe('openCaseRequestSchema', () => {
  it('accepts a non-empty id', () => {
    expect(openCaseRequestSchema.safeParse({ inboundMessageId: 'msg-1' }).success).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(openCaseRequestSchema.safeParse({ inboundMessageId: '' }).success).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(openCaseRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('approvalRequestSchema', () => {
  it('accepts a decision and a name, with no note', () => {
    const parsed = approvalRequestSchema.safeParse({ decision: 'APPROVED', decidedBy: 'Jordan' });
    expect(parsed.success).toBe(true);
  });

  it('trims decidedBy', () => {
    const parsed = approvalRequestSchema.parse({ decision: 'APPROVED', decidedBy: '  Jordan  ' });
    expect(parsed.decidedBy).toBe('Jordan');
  });

  it('rejects a blank decidedBy', () => {
    expect(
      approvalRequestSchema.safeParse({ decision: 'APPROVED', decidedBy: '   ' }).success,
    ).toBe(false);
  });

  it('rejects a decision outside the domain', () => {
    expect(
      approvalRequestSchema.safeParse({ decision: 'MAYBE', decidedBy: 'Jordan' }).success,
    ).toBe(false);
  });

  it('accepts an optional note', () => {
    const parsed = approvalRequestSchema.parse({
      decision: 'REJECTED',
      decidedBy: 'Jordan',
      note: 'Too expensive',
    });
    expect(parsed.note).toBe('Too expensive');
  });
});

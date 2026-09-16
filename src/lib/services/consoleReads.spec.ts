import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import { recordStep } from './runs';
import { saveAssessment } from './cases';
import { getCaseDetailRow, listInboxRows } from './consoleReads';

let testDb: TestDb;

beforeAll(() => {
  testDb = createTestDb('console-reads-service');
});

afterAll(async () => {
  await testDb.cleanup();
});

describe('listInboxRows', () => {
  it('includes a message with no case at all', async () => {
    await testDb.prisma.inboundMessage.create({
      data: {
        id: 'msg-bare',
        fromAddress: 'a@example.com',
        fromName: 'A',
        subject: 'Bare message',
        body: 'Body',
        receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const rows = await listInboxRows(testDb.prisma);
    const row = rows.find((r) => r.id === 'msg-bare');
    expect(row?.case).toBeNull();
  });

  it('shows the latest run status for a case with runs', async () => {
    const run = await createTestRun(testDb.prisma, 'inbox-latest');

    const rows = await listInboxRows(testDb.prisma);
    const row = rows.find((r) => r.id === `msg-inbox-latest`);
    expect(row?.case?.id).toBe(run.caseId);
    expect(row?.case?.runs[0]?.status).toBe('RUNNING');
  });
});

describe('getCaseDetailRow', () => {
  it('returns null for an unknown case', async () => {
    expect(await getCaseDetailRow('case-does-not-exist', testDb.prisma)).toBeNull();
  });

  it('returns the message and no run for a case with none', async () => {
    const message = await testDb.prisma.inboundMessage.create({
      data: {
        id: 'msg-no-run',
        fromAddress: 'b@example.com',
        fromName: 'B',
        subject: 'No run yet',
        body: 'Body',
        receivedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const { id: caseId } = await testDb.prisma.case.create({
      data: { id: 'case-no-run', inboundMessageId: message.id },
    });

    const row = await getCaseDetailRow(caseId, testDb.prisma);
    expect(row?.inboundMessage.subject).toBe('No run yet');
    expect(row?.runs).toEqual([]);
  });

  it('includes steps recorded so far on a run still in progress', async () => {
    const run = await createTestRun(testDb.prisma, 'detail-partial');
    await recordStep(
      { runId: run.id, index: 0, type: 'MODEL_CALL', durationMs: 10 },
      testDb.prisma,
    );
    await recordStep(
      { runId: run.id, index: 1, type: 'TOOL_CALL', toolName: 'check_ad_policy', durationMs: 5 },
      testDb.prisma,
    );

    const row = await getCaseDetailRow(run.caseId, testDb.prisma);
    expect(row?.runs[0]?.status).toBe('RUNNING');
    expect(row?.runs[0]?.steps).toHaveLength(2);
    expect(row?.runs[0]?.steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it('includes the assessment and approval once a run is fully decided', async () => {
    const run = await createTestRun(testDb.prisma, 'detail-decided');
    await saveAssessment(
      {
        runId: run.id,
        disposition: 'QUOTED',
        summary: 'Priced.',
        structured: '{}',
        quoteCents: 500_000,
        draftReply: 'Here you go.',
      },
      testDb.prisma,
    );
    await testDb.prisma.approval.create({
      data: { runId: run.id, decision: 'APPROVED', decidedBy: 'Jordan', decidedAt: new Date() },
    });

    const row = await getCaseDetailRow(run.caseId, testDb.prisma);
    expect(row?.runs[0]?.assessment?.quoteCents).toBe(500_000);
    expect(row?.runs[0]?.approval?.decision).toBe('APPROVED');
  });

  it('returns only the most recent run when a case has more than one', async () => {
    const first = await createTestRun(testDb.prisma, 'detail-multi-1');
    await testDb.prisma.run.update({
      where: { id: first.id },
      data: {
        status: 'FAILED',
        // Explicit, and earlier than `second`'s: `createTestRun` leaves `startedAt` at its
        // schema default of `now()`, which is later than any fixed date this suite could pick.
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        finishedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const second = await testDb.prisma.run.create({
      data: {
        id: 'run-detail-multi-2',
        caseId: first.caseId,
        modelId: 'mock',
        promptVersion: 'v1',
        maxSteps: 10,
        startedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });

    const row = await getCaseDetailRow(first.caseId, testDb.prisma);
    expect(row?.runs).toHaveLength(1);
    expect(row?.runs[0]?.id).toBe(second.id);
  });
});

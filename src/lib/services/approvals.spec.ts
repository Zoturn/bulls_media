import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import { saveAssessment } from './cases';
import { recordApproval } from './approvals';

/**
 * Against a real database: the guarantee that matters — a second decision cannot silently
 * overwrite the first — is enforced by `Approval.runId`'s unique constraint, not by this
 * function's own logic, and only a real database proves the constraint exists.
 */

let testDb: TestDb;

beforeAll(() => {
  testDb = createTestDb('approvals-service');
});

afterAll(async () => {
  await testDb.cleanup();
});

async function runWithAssessment(suffix: string, disposition: 'QUOTED' | 'REFUSED' = 'QUOTED') {
  const run = await createTestRun(testDb.prisma, suffix);
  await saveAssessment(
    {
      runId: run.id,
      disposition,
      summary: 'Priced.',
      structured: '{}',
      quoteCents: disposition === 'QUOTED' ? 500_000 : undefined,
      draftReply: disposition === 'QUOTED' ? 'Here is the quote.' : undefined,
    },
    testDb.prisma,
  );
  return run;
}

describe('recordApproval', () => {
  it('records a decision and resolves the case in one write', async () => {
    const run = await runWithAssessment('approve-ok');

    const result = await recordApproval(
      { runId: run.id, decision: 'APPROVED', decidedBy: 'Jordan', note: 'Looks right' },
      testDb.prisma,
    );

    expect(result.ok).toBe(true);
    const approval = await testDb.prisma.approval.findUnique({ where: { runId: run.id } });
    expect(approval).toMatchObject({
      decision: 'APPROVED',
      decidedBy: 'Jordan',
      note: 'Looks right',
    });

    const stored = await testDb.prisma.case.findUnique({ where: { id: run.caseId } });
    expect(stored?.status).toBe('RESOLVED');
  });

  it('records a rejection the same way as an approval', async () => {
    const run = await runWithAssessment('reject-ok');

    const result = await recordApproval(
      { runId: run.id, decision: 'REJECTED', decidedBy: 'Sam' },
      testDb.prisma,
    );

    expect(result.ok).toBe(true);
    const approval = await testDb.prisma.approval.findUnique({ where: { runId: run.id } });
    expect(approval?.decision).toBe('REJECTED');
    expect(approval?.note).toBeNull();
  });

  it('decides a run with only a review reason, no draft reply', async () => {
    const run = await runWithAssessment('review-ok', 'REFUSED');
    // REFUSED is used here only to stand in for "no draft reply" — the point under test is that
    // recordApproval does not care what the disposition was, only that an assessment exists.

    const result = await recordApproval(
      { runId: run.id, decision: 'APPROVED', decidedBy: 'Alex' },
      testDb.prisma,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects a run that has no saved assessment', async () => {
    const run = await createTestRun(testDb.prisma, 'no-assessment');

    const result = await recordApproval(
      { runId: run.id, decision: 'APPROVED', decidedBy: 'Alex' },
      testDb.prisma,
    );

    expect(result).toEqual({ ok: false, reason: 'NO_ASSESSMENT' });
    expect(await testDb.prisma.approval.count({ where: { runId: run.id } })).toBe(0);
    const stored = await testDb.prisma.case.findUnique({ where: { id: run.caseId } });
    expect(stored?.status).toBe('OPEN');
  });

  it('rejects a run that does not exist', async () => {
    const result = await recordApproval(
      { runId: 'run-does-not-exist', decision: 'APPROVED', decidedBy: 'Alex' },
      testDb.prisma,
    );
    expect(result).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
  });

  it('rejects a second decision, leaving the first unchanged', async () => {
    const run = await runWithAssessment('twice');
    await recordApproval(
      { runId: run.id, decision: 'APPROVED', decidedBy: 'First' },
      testDb.prisma,
    );

    const second = await recordApproval(
      { runId: run.id, decision: 'REJECTED', decidedBy: 'Second' },
      testDb.prisma,
    );

    expect(second).toEqual({ ok: false, reason: 'ALREADY_DECIDED' });
    const approval = await testDb.prisma.approval.findUnique({ where: { runId: run.id } });
    expect(approval?.decidedBy).toBe('First');
    expect(approval?.decision).toBe('APPROVED');
  });
});

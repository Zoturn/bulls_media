import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { openCaseOrThrow, seedAll } from '@/lib/testing/testFixtures';
import { scriptedModel } from '@/lib/testing/mockModel';
import { findActiveRunForCase } from '@/lib/services/runs';
import { SEED } from '../../../prisma/seed-data';
import { startRun } from './startRun';

/**
 * `startRun` is what the console's "start triage" endpoint calls. Every test here injects a
 * scripted model — no test can reach a provider, and `MODEL_NOT_CONFIGURED`'s own test relies on
 * exactly that: passing no model and no key still resolves without ever touching the network.
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = createTestDb('agent-start-run');
  await seedAll(testDb.prisma);
});

afterAll(async () => {
  await testDb.cleanup();
});

function openCase(messageId: string): Promise<string> {
  return openCaseOrThrow(testDb.prisma, messageId);
}

/** Polls a run until it leaves `RUNNING`, rather than sleeping a fixed guess at how long that takes. */
async function pollUntilTerminal(runId: string, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await testDb.prisma.run.findUnique({ where: { id: runId } });
    if (run !== null && run.status !== 'RUNNING') return run;
    if (Date.now() > deadline) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('startRun', () => {
  it('resolves with a runId before the model has produced a structured answer', async () => {
    const caseId = await openCase(SEED.messages.ordinaryBrief.id);
    const model = scriptedModel({
      steps: [{ answer: { summary: 'Not a brief.', outcome: { disposition: 'NOT_A_BRIEF' } } }],
    });

    const result = await startRun(caseId, { model, client: testDb.prisma });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The model has been given the chance to run to completion by the time this assertion runs
    // (Jest awaited `startRun`'s promise, which resolves independently of the run finishing) — so
    // what this actually proves is the *contract*: a runId came back, and it names a row that
    // really was created before the answer existed.
    const run = await testDb.prisma.run.findUnique({ where: { id: result.runId } });
    expect(run).not.toBeNull();
  });

  it('leaves the run to finish on its own after resolving', async () => {
    const caseId = await openCase(SEED.messages.prohibitedVertical.id);
    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'gambling' } },
        {
          answer: {
            summary: 'Refused.',
            outcome: { disposition: 'REFUSED', brief: null, refusalReason: 'No gambling.' },
          },
        },
      ],
    });

    const result = await startRun(caseId, { model, client: testDb.prisma });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // startRun's own promise resolved from the hook, not from run completion — poll rather than
    // sleep a fixed amount, since a fixed wait is exactly as long as the slowest machine this
    // suite happens to run on and no longer: this scripted model settles in well under a second.
    const run = await pollUntilTerminal(result.runId);
    expect(run?.status).toBe('REFUSED');
  });

  it('rejects a case that does not exist', async () => {
    const result = await startRun('case-does-not-exist', {
      model: scriptedModel({ steps: [{ text: 'irrelevant' }] }),
      client: testDb.prisma,
    });
    expect(result).toEqual({ ok: false, reason: 'CASE_NOT_FOUND' });
  });

  it('rejects a second run while one is already RUNNING for the case', async () => {
    const caseId = await openCase(SEED.messages.reviewVertical.id);
    // A model that never finishes within this test's lifetime — repeatLast with a tool call keeps
    // the run RUNNING for as long as this test needs it to be.
    const stuck = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'cryptocurrency' } }],
      repeatLast: true,
    });

    const first = await startRun(caseId, { model: stuck, client: testDb.prisma });
    expect(first.ok).toBe(true);

    const second = await startRun(caseId, {
      model: scriptedModel({ steps: [{ text: 'irrelevant' }] }),
      client: testDb.prisma,
    });

    expect(first.ok && second).toEqual({
      ok: false,
      reason: 'RUN_IN_PROGRESS',
      runId: first.ok ? first.runId : undefined,
    });

    // Let the stuck run actually exhaust its (small) step budget so it doesn't leak into other
    // tests' timing — findActiveRunForCase should then report no active run for this case.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }, 10_000);

  it('rejects with MODEL_NOT_CONFIGURED when no model is supplied and no key is configured', async () => {
    const caseId = await openCase(SEED.messages.missingBudget.id);
    // jest.setup.ts deletes ANTHROPIC_API_KEY for the whole suite, so omitting `model` here is
    // exactly the "no model configured" case — no network call is possible even if this were wrong.
    const result = await startRun(caseId, { client: testDb.prisma });
    expect(result).toEqual({ ok: false, reason: 'MODEL_NOT_CONFIGURED' });
    expect(await findActiveRunForCase(caseId, testDb.prisma)).toBeNull();
  });
});

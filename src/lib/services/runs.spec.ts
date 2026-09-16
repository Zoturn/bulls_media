import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import { closeRun, createRun, findActiveRunForCase, listRunSteps, recordStep } from './runs';

/**
 * Against a real database, because every guarantee here is one the schema enforces — the ordering
 * index, the unique constraint that stops two steps claiming the same slot, the cascade. A mocked
 * Prisma client would only prove the mock returns what it was told.
 */

let testDb: TestDb;

beforeAll(() => {
  testDb = createTestDb('runs-service');
});

afterAll(async () => {
  await testDb.cleanup();
});

async function caseWithRun(suffix: string): Promise<string> {
  const run = await createTestRun(testDb.prisma, suffix);
  return run.caseId;
}

/** A case with no run at all — `createTestRun` always creates one, which `findActiveRunForCase`'s
 * own tests need to avoid: they create their own run and must not compete with a fixture one. */
async function bareCase(suffix: string): Promise<string> {
  const message = await testDb.prisma.inboundMessage.create({
    data: {
      id: `msg-${suffix}`,
      fromAddress: 'test@example.com',
      fromName: 'Test Sender',
      subject: 'Test',
      body: 'Test body',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const { id } = await testDb.prisma.case.create({
    data: { id: `case-${suffix}`, inboundMessageId: message.id },
  });
  return id;
}

describe('createRun', () => {
  it('starts a run RUNNING, recording the model, prompt version and step budget', async () => {
    const caseId = await caseWithRun('create');
    const { id } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 12 },
      testDb.prisma,
    );

    const run = await testDb.prisma.run.findUnique({ where: { id } });
    expect(run).toMatchObject({
      status: 'RUNNING',
      modelId: 'mock-model',
      promptVersion: 'v1',
      maxSteps: 12,
      finishedAt: null,
    });
  });
});

describe('recordStep and listRunSteps', () => {
  it('returns steps in index order, whatever order they were written in', async () => {
    const caseId = await caseWithRun('steps-order');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );

    await recordStep({ runId, index: 1, type: 'TOOL_CALL', durationMs: 4 }, testDb.prisma);
    await recordStep({ runId, index: 0, type: 'MODEL_CALL', durationMs: 9 }, testDb.prisma);
    await recordStep({ runId, index: 2, type: 'TERMINAL', durationMs: 0 }, testDb.prisma);

    const steps = await listRunSteps(runId, testDb.prisma);
    expect(steps.map((step) => step.index)).toEqual([0, 1, 2]);
    expect(steps.map((step) => step.type)).toEqual(['MODEL_CALL', 'TOOL_CALL', 'TERMINAL']);
  });

  it('refuses a second step at the same index', async () => {
    const caseId = await caseWithRun('steps-unique');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );

    await recordStep({ runId, index: 0, type: 'MODEL_CALL', durationMs: 1 }, testDb.prisma);
    await expect(
      recordStep({ runId, index: 0, type: 'TOOL_CALL', durationMs: 1 }, testDb.prisma),
    ).rejects.toThrow();
  });

  it('stores absent optional fields as null rather than undefined', async () => {
    const caseId = await caseWithRun('steps-nulls');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );

    await recordStep({ runId, index: 0, type: 'MODEL_CALL', durationMs: 3 }, testDb.prisma);
    const [step] = await listRunSteps(runId, testDb.prisma);
    expect(step).toMatchObject({
      toolName: null,
      input: null,
      output: null,
      error: null,
      tokens: null,
    });
  });
});

describe('closeRun', () => {
  it('sets the terminal status and a finish time', async () => {
    const caseId = await caseWithRun('close-ok');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );

    expect(await closeRun({ runId, status: 'COMPLETED', totalTokens: 400 }, testDb.prisma)).toEqual(
      {
        ok: true,
      },
    );

    const run = await testDb.prisma.run.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('COMPLETED');
    expect(run?.totalTokens).toBe(400);
    expect(run?.finishedAt).not.toBeNull();
  });

  it('does not overwrite a status that already explains what happened', async () => {
    const caseId = await caseWithRun('close-twice');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );

    await closeRun({ runId, status: 'REFUSED' }, testDb.prisma);
    const second = await closeRun(
      { runId, status: 'FAILED', errorMessage: 'a later error' },
      testDb.prisma,
    );

    expect(second).toEqual({ ok: false, reason: 'ALREADY_CLOSED', status: 'REFUSED' });
    const run = await testDb.prisma.run.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('REFUSED');
    expect(run?.errorMessage).toBeNull();
  });

  it('fails loudly for a run that does not exist', async () => {
    await expect(
      closeRun({ runId: 'run-does-not-exist', status: 'FAILED' }, testDb.prisma),
    ).rejects.toThrow(/run-does-not-exist/);
  });
});

describe('the cascade', () => {
  it('takes a run and its steps with the case', async () => {
    const caseId = await caseWithRun('cascade');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );
    await recordStep({ runId, index: 0, type: 'MODEL_CALL', durationMs: 1 }, testDb.prisma);

    await testDb.prisma.case.delete({ where: { id: caseId } });

    expect(await testDb.prisma.run.count({ where: { id: runId } })).toBe(0);
    expect(await testDb.prisma.runStep.count({ where: { runId } })).toBe(0);
  });
});

describe('findActiveRunForCase', () => {
  it('finds the RUNNING run for a case', async () => {
    const caseId = await bareCase('active-running');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );

    expect(await findActiveRunForCase(caseId, testDb.prisma)).toEqual({ id: runId });
  });

  it('returns null once the run has closed', async () => {
    const caseId = await bareCase('active-closed');
    const { id: runId } = await createRun(
      { caseId, modelId: 'mock-model', promptVersion: 'v1', maxSteps: 5 },
      testDb.prisma,
    );
    await closeRun({ runId, status: 'COMPLETED' }, testDb.prisma);

    expect(await findActiveRunForCase(caseId, testDb.prisma)).toBeNull();
  });

  it('returns null for a case that has never had a run', async () => {
    const caseId = await bareCase('active-none');
    expect(await findActiveRunForCase(caseId, testDb.prisma)).toBeNull();
  });
});

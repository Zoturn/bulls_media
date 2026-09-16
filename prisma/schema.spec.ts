import type { PrismaClient } from '@prisma/client';
import { createTestDb } from '@/lib/testing/testDb';

/**
 * Cascade delete and the `@@unique([runId, index])` constraint are guarantees the *schema*
 * makes, not the application code — mocking Prisma here would only prove the mock does what it
 * was told, never that SQLite actually enforces the foreign key or the unique index. So this
 * spec runs against a real, disposable SQLite file, migrated fresh in `beforeAll` and removed in
 * `afterAll` (via `createTestDb`, shared with the service-level integration specs). It stays a
 * Jest spec rather than a Cypress one because nothing here crosses an HTTP or browser boundary —
 * only the database does, and Jest already runs in the same Node process that talks to it
 * directly.
 */

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('schema'));
}, 30_000);

afterAll(async () => {
  await cleanup();
});

async function createCaseWithRun(idSuffix: string) {
  const message = await prisma.inboundMessage.create({
    data: {
      id: `msg-${idSuffix}`,
      fromAddress: 'test@example.com',
      fromName: 'Test Sender',
      subject: 'Test',
      body: 'Test body',
      receivedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  const testCase = await prisma.case.create({
    data: { id: `case-${idSuffix}`, inboundMessageId: message.id },
  });
  const run = await prisma.run.create({
    data: {
      id: `run-${idSuffix}`,
      caseId: testCase.id,
      modelId: 'mock',
      promptVersion: 'v1',
      maxSteps: 10,
    },
  });
  return { message, case: testCase, run };
}

describe('schema: cascade delete', () => {
  it('deleting a Case removes its Run and RunStep rows', async () => {
    const { case: testCase, run } = await createCaseWithRun('cascade-1');
    await prisma.runStep.create({
      data: { runId: run.id, index: 0, type: 'MODEL_CALL', durationMs: 10 },
    });
    await prisma.runStep.create({
      data: {
        runId: run.id,
        index: 1,
        type: 'TOOL_CALL',
        toolName: 'check_ad_policy',
        durationMs: 20,
      },
    });

    await prisma.case.delete({ where: { id: testCase.id } });

    expect(await prisma.run.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await prisma.runStep.findMany({ where: { runId: run.id } })).toHaveLength(0);
  });

  it('deleting a Case removes its Assessment and Approval rows', async () => {
    const { case: testCase, run } = await createCaseWithRun('cascade-2');
    await prisma.assessment.create({
      data: {
        runId: run.id,
        disposition: 'QUOTED',
        summary: 'Test summary',
        structured: '{}',
      },
    });
    await prisma.approval.create({ data: { runId: run.id } });

    await prisma.case.delete({ where: { id: testCase.id } });

    expect(await prisma.assessment.findUnique({ where: { runId: run.id } })).toBeNull();
    expect(await prisma.approval.findUnique({ where: { runId: run.id } })).toBeNull();
  });
});

describe('schema: step ordering and uniqueness', () => {
  it('reads RunStep rows back in index order regardless of insert order', async () => {
    const { run } = await createCaseWithRun('order-1');

    // Inserted out of order on purpose — the guarantee is about read order, not insert order.
    await prisma.runStep.create({
      data: { runId: run.id, index: 2, type: 'TERMINAL', durationMs: 5 },
    });
    await prisma.runStep.create({
      data: { runId: run.id, index: 0, type: 'MODEL_CALL', durationMs: 15 },
    });
    await prisma.runStep.create({
      data: { runId: run.id, index: 1, type: 'TOOL_CALL', durationMs: 25 },
    });

    const steps = await prisma.runStep.findMany({
      where: { runId: run.id },
      orderBy: { index: 'asc' },
    });

    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('rejects a second step claiming an index already taken on the same run', async () => {
    const { run } = await createCaseWithRun('order-2');
    await prisma.runStep.create({
      data: { runId: run.id, index: 0, type: 'MODEL_CALL', durationMs: 5 },
    });

    await expect(
      prisma.runStep.create({
        data: { runId: run.id, index: 0, type: 'TOOL_CALL', durationMs: 5 },
      }),
    ).rejects.toThrow();

    expect(await prisma.runStep.count({ where: { runId: run.id } })).toBe(1);
  });

  it('allows the same index across two different runs', async () => {
    const { run: runA } = await createCaseWithRun('order-3a');
    const { run: runB } = await createCaseWithRun('order-3b');

    await prisma.runStep.create({
      data: { runId: runA.id, index: 0, type: 'MODEL_CALL', durationMs: 5 },
    });

    await expect(
      prisma.runStep.create({
        data: { runId: runB.id, index: 0, type: 'MODEL_CALL', durationMs: 5 },
      }),
    ).resolves.toBeDefined();
  });
});

describe('schema: message ownership', () => {
  it('stores the body once on InboundMessage, and Case references it rather than copying it', async () => {
    const { message, case: testCase } = await createCaseWithRun('ownership-1');

    const fetchedCase = await prisma.case.findUniqueOrThrow({
      where: { id: testCase.id },
      include: { inboundMessage: true },
    });

    // The Case row itself carries no body field — TypeScript already enforces this at the type
    // level (Case has no `body` property to access), so this asserts it at the data level too:
    // the body is reachable only through the relation, not duplicated onto the case.
    expect('body' in fetchedCase).toBe(false);
    expect(fetchedCase.inboundMessage.body).toBe(message.body);
  });
});

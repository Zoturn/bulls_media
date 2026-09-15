import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * Cascade delete and the `@@unique([runId, index])` constraint are guarantees the *schema*
 * makes, not the application code — mocking Prisma here would only prove the mock does what it
 * was told, never that SQLite actually enforces the foreign key or the unique index. So this
 * spec runs against a real, disposable SQLite file, migrated fresh in `beforeAll` and removed in
 * `afterAll`. It stays a Jest spec rather than a Cypress one because nothing here crosses an HTTP
 * or browser boundary — only the database does, and Jest already runs in the same Node process
 * that talks to it directly.
 */

const TEST_DB_PATH = path.join(__dirname, 'schema-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const PROJECT_ROOT = path.join(__dirname, '..');
// The local binary directly, not `npx prisma`: npx spends time resolving and launching prisma as
// its own child process before prisma does the same for its own subcommand — one process layer
// this test pays on every Jest run for no benefit, since the binary is already installed.
const PRISMA_BIN = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

// Removes the db file and every SQLite sidecar file it may have left (-journal in rollback mode,
// -wal/-shm in WAL mode) — one function so beforeAll's pre-clean and afterAll's post-clean can't
// drift into cleaning up a different set of files from each other.
function removeTestDbFiles(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const f = TEST_DB_PATH + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

let prisma: PrismaClient;

beforeAll(() => {
  removeTestDbFiles();

  // `migrate deploy`, applying the real committed migration file — not `db push`, which
  // recomputes DDL directly from schema.prisma and would let this spec pass against a schema
  // that migrate deploy (what CI and any real deploy actually runs) would not produce the same
  // way if the two ever drifted. This spec's whole point is proving the shipped migration
  // enforces cascade delete and the unique constraint, so it has to run that migration.
  // `shell: true` because on Windows the binary is `prisma.cmd`, a batch launcher execFileSync
  // cannot invoke directly — the shell is what knows how to run it.
  execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
    shell: true,
  });

  prisma = new PrismaClient({ datasourceUrl: TEST_DB_URL });
}, 30_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeTestDbFiles();
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

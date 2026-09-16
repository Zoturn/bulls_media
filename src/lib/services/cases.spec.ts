import type { PrismaClient } from '@prisma/client';
import { createTestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import { saveAssessment } from './cases';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('cases-service'));
}, 30_000);

afterAll(async () => {
  await cleanup();
});

/** A fresh Case + Run for each test, so saveAssessment always has something real to write against. */
function createRun(idSuffix: string) {
  return createTestRun(prisma, idSuffix);
}

describe('saveAssessment', () => {
  it('persists a quoted assessment with its quote', async () => {
    const run = await createRun('quoted-1');

    const result = await saveAssessment(
      {
        runId: run.id,
        disposition: 'QUOTED',
        summary: 'Priced the display package.',
        structured: '{"disposition":"QUOTED"}',
        quoteCents: 240_000,
      },
      prisma,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(stored?.disposition).toBe('QUOTED');
    expect(stored?.quoteCents).toBe(240_000);
  });

  it('persists a refused assessment with no quote, even if a quote was passed', async () => {
    const run = await createRun('refused-1');

    const result = await saveAssessment(
      {
        runId: run.id,
        disposition: 'REFUSED',
        summary: 'Prohibited vertical.',
        structured: '{"disposition":"REFUSED"}',
        refusalReason: 'Gambling advertising is not accepted.',
        quoteCents: 999_999, // must be dropped — a refusal carries no quote
      },
      prisma,
    );

    expect(result.ok).toBe(true);

    const stored = await prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(stored?.disposition).toBe('REFUSED');
    expect(stored?.quoteCents).toBeNull();
    expect(stored?.refusalReason).toBe('Gambling advertising is not accepted.');
  });

  it('fails with RUN_NOT_FOUND rather than creating an orphaned Assessment', async () => {
    const result = await saveAssessment(
      {
        runId: 'does-not-exist',
        disposition: 'QUOTED',
        summary: 'x',
        structured: '{}',
      },
      prisma,
    );

    expect(result).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });

    const orphans = await prisma.assessment.findMany({ where: { runId: 'does-not-exist' } });
    expect(orphans).toHaveLength(0);
  });

  it('fails with ALREADY_SAVED on a second save for the same run, leaving the first unchanged', async () => {
    const run = await createRun('duplicate-1');

    await saveAssessment(
      {
        runId: run.id,
        disposition: 'QUOTED',
        summary: 'First save.',
        structured: '{}',
        quoteCents: 100,
      },
      prisma,
    );

    const second = await saveAssessment(
      {
        runId: run.id,
        disposition: 'QUOTED',
        summary: 'Second save.',
        structured: '{}',
        quoteCents: 200,
      },
      prisma,
    );

    expect(second).toEqual({ ok: false, reason: 'ALREADY_SAVED' });

    const stored = await prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(stored?.summary).toBe('First save.');
    expect(stored?.quoteCents).toBe(100);
  });
});

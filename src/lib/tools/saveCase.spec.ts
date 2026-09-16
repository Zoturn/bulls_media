import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { callTool } from '@/lib/testing/callTool';
import { createTestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import { createSaveCaseTool, type saveCaseOutputSchema } from './saveCase';

type SaveCaseOutput = z.infer<typeof saveCaseOutputSchema>;

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  ({ prisma, cleanup } = createTestDb('save-case-tool'));
}, 30_000);

afterAll(async () => {
  await cleanup();
});

function createRun(idSuffix: string) {
  return createTestRun(prisma, idSuffix);
}

describe('saveCaseTool', () => {
  it('saves a quoted assessment', async () => {
    const run = await createRun('tool-quoted-1');
    const saveCaseTool = createSaveCaseTool(prisma);

    const result = await callTool<SaveCaseOutput>(saveCaseTool, {
      runId: run.id,
      disposition: 'QUOTED',
      summary: 'Priced the package.',
      structured: '{}',
      quoteCents: 50_000,
    });

    expect(result.ok).toBe(true);
  });

  it('fails with RUN_NOT_FOUND for an unknown run', async () => {
    const saveCaseTool = createSaveCaseTool(prisma);

    const result = await callTool<SaveCaseOutput>(saveCaseTool, {
      runId: 'does-not-exist',
      disposition: 'REFUSED',
      summary: 'x',
      structured: '{}',
    });

    expect(result).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
  });

  it('fails with ALREADY_SAVED on a second save for the same run', async () => {
    const run = await createRun('tool-duplicate-1');
    const saveCaseTool = createSaveCaseTool(prisma);

    await callTool<SaveCaseOutput>(saveCaseTool, {
      runId: run.id,
      disposition: 'REFUSED',
      summary: 'First.',
      structured: '{}',
    });
    const second = await callTool<SaveCaseOutput>(saveCaseTool, {
      runId: run.id,
      disposition: 'REFUSED',
      summary: 'Second.',
      structured: '{}',
    });

    expect(second).toEqual({ ok: false, reason: 'ALREADY_SAVED' });
  });
});

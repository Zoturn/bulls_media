import { callTool } from '@/lib/testing/callTool';
import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import type { saveCaseOutputSchema } from '@/lib/tools/saveCase';
import type { z } from 'zod';
import { buildRunTools, createRunBoundSaveCaseTool } from './tools';

type SaveCaseOutput = z.infer<typeof saveCaseOutputSchema>;

let testDb: TestDb;

beforeAll(() => {
  testDb = createTestDb('agent-tools');
});

afterAll(async () => {
  await testDb.cleanup();
});

describe('buildRunTools', () => {
  it('offers the same five tool names the phase allowlist is written against', () => {
    expect(Object.keys(buildRunTools('run-x', testDb.prisma)).sort()).toEqual([
      'calculate_quote',
      'check_ad_policy',
      'lookup_inventory',
      'save_case',
      'search_rate_card',
    ]);
  });
});

describe('createRunBoundSaveCaseTool', () => {
  it('does not ask the model for a run id', () => {
    const tool = createRunBoundSaveCaseTool('run-x', testDb.prisma);
    const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    expect(Object.keys(shape)).not.toContain('runId');
  });

  it('saves against the run it was bound to', async () => {
    const run = await createTestRun(testDb.prisma, 'bound-save');
    const tool = createRunBoundSaveCaseTool(run.id, testDb.prisma);

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'REFUSED',
      summary: 'Gambling is not accepted.',
      structured: JSON.stringify({ summary: 'Refused.' }),
      refusalReason: 'Gambling is not accepted.',
    });

    expect(result.ok).toBe(true);
    const saved = await testDb.prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(saved?.disposition).toBe('REFUSED');
  });

  it('refuses a second save for the same run rather than overwriting the first', async () => {
    const run = await createTestRun(testDb.prisma, 'bound-save-twice');
    const tool = createRunBoundSaveCaseTool(run.id, testDb.prisma);
    const input = {
      disposition: 'NOT_A_BRIEF' as const,
      summary: 'An invoice query, not a brief.',
      structured: '{}',
    };

    await callTool<SaveCaseOutput>(tool, input);
    const second = await callTool<SaveCaseOutput>(tool, {
      ...input,
      disposition: 'QUOTED' as const,
      quoteCents: 999_999,
    });

    expect(second).toEqual({ ok: false, reason: 'ALREADY_SAVED' });
    const saved = await testDb.prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(saved?.disposition).toBe('NOT_A_BRIEF');
    expect(saved?.quoteCents).toBeNull();
  });

  it('reports a run that does not exist rather than throwing', async () => {
    const tool = createRunBoundSaveCaseTool('run-does-not-exist', testDb.prisma);
    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'NOT_A_BRIEF',
      summary: 'Not a brief.',
      structured: '{}',
    });
    expect(result).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
  });
});

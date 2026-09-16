import { callTool } from '@/lib/testing/callTool';
import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { createTestRun } from '@/lib/testing/testFixtures';
import { policyResult, quoteResult } from '@/lib/testing/toolResults';
import type { saveCaseOutputSchema } from '@/lib/tools/saveCase';
import type { z } from 'zod';
import { buildRunTools, createRunBoundSaveCaseTool } from './tools';
import type { RecordedToolResult } from './phases';

type SaveCaseOutput = z.infer<typeof saveCaseOutputSchema>;

let testDb: TestDb;

/**
 * A run with nothing recorded yet. Every post-condition that could fire needs a claim to
 * contradict, and an empty history contradicts nothing except a QUOTED claim — so these tests
 * exercise the write path itself, and the post-conditions have their own spec.
 */
const noHistory = (): RecordedToolResult[] => [];

/** The checks a result failed, or an empty list — narrowing the union by `reason` once, here. */
function violatedChecks(result: SaveCaseOutput): string[] {
  if (result.ok || result.reason !== 'POST_CONDITION_FAILED') return [];
  return result.violations.map((violation) => violation.check);
}

beforeAll(() => {
  testDb = createTestDb('agent-tools');
});

afterAll(async () => {
  await testDb.cleanup();
});

describe('buildRunTools', () => {
  it('offers the same five tool names the phase allowlist is written against', () => {
    expect(Object.keys(buildRunTools('run-x', noHistory, testDb.prisma)).sort()).toEqual([
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
    const tool = createRunBoundSaveCaseTool('run-x', noHistory, testDb.prisma);
    const shape = (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    expect(Object.keys(shape)).not.toContain('runId');
  });

  it('saves against the run it was bound to', async () => {
    const run = await createTestRun(testDb.prisma, 'bound-save');
    const tool = createRunBoundSaveCaseTool(run.id, noHistory, testDb.prisma);

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
    const tool = createRunBoundSaveCaseTool(run.id, noHistory, testDb.prisma);
    const input = {
      disposition: 'NOT_A_BRIEF' as const,
      summary: 'An invoice query, not a brief.',
      structured: '{}',
    };

    await callTool<SaveCaseOutput>(tool, input);
    // A second claim that passes the post-conditions, so this test exercises ALREADY_SAVED rather
    // than tripping over a guardrail on its way there.
    const second = await callTool<SaveCaseOutput>(tool, { ...input, summary: 'Second save.' });

    expect(second).toEqual({ ok: false, reason: 'ALREADY_SAVED' });
    const saved = await testDb.prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(saved?.summary).toBe('An invoice query, not a brief.');
    expect(saved?.quoteCents).toBeNull();
  });

  it('reports a run that does not exist rather than throwing', async () => {
    const tool = createRunBoundSaveCaseTool('run-does-not-exist', noHistory, testDb.prisma);
    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'NOT_A_BRIEF',
      summary: 'Not a brief.',
      structured: '{}',
    });
    expect(result).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
  });
});

describe('createRunBoundSaveCaseTool — post-conditions', () => {
  it('refuses a total that calculate_quote did not return, and writes nothing', async () => {
    const run = await createTestRun(testDb.prisma, 'pc-wrong-total');
    const history = [policyResult('ALLOW', 'automotive'), quoteResult(7_600_000)];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'QUOTED',
      summary: 'Priced.',
      structured: '{}',
      quoteCents: 1_000, // a number the tool never produced
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('POST_CONDITION_FAILED');
    expect(await testDb.prisma.assessment.count({ where: { runId: run.id } })).toBe(0);
  });

  it('lets the model correct itself and save on a second call', async () => {
    const run = await createTestRun(testDb.prisma, 'pc-corrected');
    const history = [policyResult('ALLOW', 'automotive'), quoteResult(7_600_000)];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);
    const base = { disposition: 'QUOTED' as const, summary: 'Priced.', structured: '{}' };

    const first = await callTool<SaveCaseOutput>(tool, { ...base, quoteCents: 1_000 });
    expect(first.ok).toBe(false);

    const second = await callTool<SaveCaseOutput>(tool, { ...base, quoteCents: 7_600_000 });
    expect(second.ok).toBe(true);

    const saved = await testDb.prisma.assessment.findUnique({ where: { runId: run.id } });
    expect(saved?.quoteCents).toBe(7_600_000);
  });

  it('refuses a quote on a run where calculate_quote never ran', async () => {
    const run = await createTestRun(testDb.prisma, 'pc-no-calculation');
    const history = [policyResult('ALLOW', 'automotive')];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'QUOTED',
      summary: 'Priced.',
      structured: '{}',
      quoteCents: 7_600_000,
    });

    expect(result.ok).toBe(false);
    expect(violatedChecks(result)).toContain('QUOTE_HAS_A_CALCULATION');
  });

  it('refuses a disposition the policy decision contradicts', async () => {
    const run = await createTestRun(testDb.prisma, 'pc-contradicts-policy');
    const history = [policyResult('REFUSE', 'gambling'), quoteResult(500_000)];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'QUOTED',
      summary: 'Priced.',
      structured: '{}',
      quoteCents: 500_000,
    });

    expect(result.ok).toBe(false);
    expect(violatedChecks(result)).toContain('DISPOSITION_MATCHES_POLICY');
    expect(await testDb.prisma.assessment.count({ where: { runId: run.id } })).toBe(0);
  });

  it('checks the vertical inside the structured payload, not only the fields beside it', async () => {
    // The row this writes is the artefact a human later approves. A model could name a vertical
    // policy was never asked about in the payload it persists, while returning a clean answer at
    // the other boundary — so the persisted payload is checked here, where it is written.
    const run = await createTestRun(testDb.prisma, 'pc-vertical');
    const history = [policyResult('ALLOW', 'automotive')];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const structured = JSON.stringify({
      summary: 'Needs more detail.',
      outcome: {
        disposition: 'NEEDS_INFO',
        brief: {
          advertiser: 'Someone',
          vertical: 'gambling', // policy was asked about automotive
          channel: null,
          budgetCents: null,
          requestedVolume: null,
          flightDays: null,
        },
        missingFields: ['budget'],
        draftReply: 'Could you share a budget?',
      },
    });

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'NEEDS_INFO',
      summary: 'Needs more detail.',
      structured,
    });

    expect(result.ok).toBe(false);
    expect(violatedChecks(result)).toContain('VERTICAL_WAS_ASSESSED');
    expect(await testDb.prisma.assessment.count({ where: { runId: run.id } })).toBe(0);
  });

  it('accepts a structured payload whose vertical matches what policy was asked', async () => {
    const run = await createTestRun(testDb.prisma, 'pc-vertical-ok');
    const history = [policyResult('ALLOW', 'automotive')];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const structured = JSON.stringify({
      summary: 'Needs more detail.',
      outcome: {
        disposition: 'NEEDS_INFO',
        brief: {
          advertiser: 'North Road Autos',
          vertical: 'automotive',
          channel: null,
          budgetCents: null,
          requestedVolume: null,
          flightDays: null,
        },
        missingFields: ['budget'],
        draftReply: 'Could you share a budget?',
      },
    });

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'NEEDS_INFO',
      summary: 'Needs more detail.',
      structured,
    });

    expect(result.ok).toBe(true);
  });

  it('does not reject a payload that is simply not an assessment', async () => {
    // A `structured` string the assessment schema cannot parse contributes no vertical to check.
    // The other checks still apply — it is unparseable, not exempt.
    const run = await createTestRun(testDb.prisma, 'pc-structured-opaque');
    const history = [policyResult('ALLOW', 'automotive')];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'NEEDS_INFO',
      summary: 'Needs more detail.',
      structured: 'not json at all',
    });

    expect(result.ok).toBe(true);
  });

  it('lets a clean claim through', async () => {
    const run = await createTestRun(testDb.prisma, 'pc-clean');
    const history = [policyResult('ALLOW', 'automotive'), quoteResult(7_600_000)];
    const tool = createRunBoundSaveCaseTool(run.id, () => history, testDb.prisma);

    const result = await callTool<SaveCaseOutput>(tool, {
      disposition: 'QUOTED',
      summary: 'Priced.',
      structured: '{}',
      quoteCents: 7_600_000,
    });

    expect(result.ok).toBe(true);
  });
});

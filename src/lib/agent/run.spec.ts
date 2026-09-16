import { SEED } from '../../../prisma/seed-data';
import { scriptedModel, toolsOfferedAt } from '@/lib/testing/mockModel';
import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { seedAll } from '@/lib/testing/testFixtures';
import { openCaseForMessage } from '@/lib/services/cases';
import { listRunSteps } from '@/lib/services/runs';
import { executeRun } from './run';
import type { Assessment } from './assessment';

/**
 * The run loop, end to end, against a scripted model and a real database.
 *
 * No test here can reach a provider: every run is given a `MockLanguageModelV4`, and
 * jest.setup.ts deletes the provider keys besides. What is being asserted is not that a model
 * behaves — it is that the bounds around one hold whatever it does, so several of these scripts
 * are deliberately a model misbehaving.
 */

let testDb: TestDb;

const BRIEF = SEED.messages.ordinaryBrief;
const CASINO = SEED.messages.prohibitedVertical;
const CRYPTO = SEED.messages.reviewVertical;
const INJECTION = SEED.messages.injectionAttempt;

const briefFor = (advertiser: string, vertical: string) => ({
  advertiser,
  vertical,
  channel: 'display' as const,
  budgetCents: 1_800_000,
  requestedVolume: 1_000_000,
  flightDays: 30,
});

/** The five tools, as `toolsOfferedAt` sorts them. */
const ALL_TOOLS = [
  'calculate_quote',
  'check_ad_policy',
  'lookup_inventory',
  'save_case',
  'search_rate_card',
];

beforeAll(async () => {
  testDb = createTestDb('agent-run');
  await seedAll(testDb.prisma);
});

afterAll(async () => {
  await testDb.cleanup();
});

async function openCase(messageId: string): Promise<string> {
  const { id } = await openCaseForMessage(messageId, testDb.prisma);
  return id;
}

describe('executeRun — the ordinary path', () => {
  it('checks policy, researches, prices, saves, and completes with the quoted total', async () => {
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'North Road Autos want display and video for a spring sale; quoted.',
      outcome: {
        disposition: 'QUOTED',
        brief: briefFor('North Road Autos', 'automotive'),
        quote: {
          lineItems: [
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 7_600_000 },
          ],
          totalCents: 7_600_000,
        },
        draftReply: 'Hi Priya — here are the packages we can offer.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'automotive' } },
        { call: 'search_rate_card', input: { query: 'display run of site', channel: 'display' } },
        {
          call: 'lookup_inventory',
          input: { packageId: 'rate-display-ros', requestedVolume: 1_000_000 },
        },
        {
          call: 'calculate_quote',
          input: { lineItems: [{ packageId: 'rate-display-ros', requestedVolume: 1_000_000 }] },
        },
        {
          call: 'save_case',
          input: {
            disposition: 'QUOTED',
            summary: answer.summary,
            structured: JSON.stringify(answer),
            quoteCents: 7_600_000,
            draftReply: 'Hi Priya — here are the packages we can offer.',
          },
        },
        { answer },
      ],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    expect(result.status).toBe('COMPLETED');
    expect(result.assessment?.outcome.disposition).toBe('QUOTED');

    const saved = await testDb.prisma.assessment.findUnique({ where: { runId: result.runId } });
    expect(saved?.disposition).toBe('QUOTED');
    expect(saved?.quoteCents).toBe(7_600_000);
  });

  it('offers only the current phase tools, widening as results come in', async () => {
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'Priced.',
      outcome: {
        disposition: 'QUOTED',
        brief: briefFor('North Road Autos', 'automotive'),
        quote: {
          lineItems: [
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 7_600_000 },
          ],
          totalCents: 7_600_000,
        },
        draftReply: 'Draft.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'automotive' } },
        {
          call: 'lookup_inventory',
          input: { packageId: 'rate-display-ros', requestedVolume: 1_000_000 },
        },
        {
          call: 'calculate_quote',
          input: { lineItems: [{ packageId: 'rate-display-ros', requestedVolume: 1_000_000 }] },
        },
        { answer },
      ],
    });

    await executeRun(caseId, { model, client: testDb.prisma });

    expect(toolsOfferedAt(model, 0)).toEqual(['check_ad_policy', 'save_case']);
    expect(toolsOfferedAt(model, 1)).toEqual(['lookup_inventory', 'save_case', 'search_rate_card']);
    expect(toolsOfferedAt(model, 2)).toEqual(['calculate_quote', 'save_case']);
    expect(toolsOfferedAt(model, 3)).toEqual(['save_case']);
    // The whole set was never on the table at once.
    expect(
      model.doGenerateCalls.map((_, index) => toolsOfferedAt(model, index)),
    ).not.toContainEqual(ALL_TOOLS);
  });
});

describe('executeRun — refusal and review', () => {
  it('refuses a prohibited vertical without ever offering a pricing tool', async () => {
    const caseId = await openCase(CASINO.id);
    const answer = {
      summary: 'Online casino: gambling is not accepted on this network.',
      outcome: {
        disposition: 'REFUSED',
        brief: { ...briefFor('LuckySpin', 'gambling'), budgetCents: 5_000_000 },
        refusalReason: 'Gambling and betting advertising is not accepted on this network.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'gambling' } },
        {
          call: 'save_case',
          input: {
            disposition: 'REFUSED',
            summary: answer.summary,
            structured: JSON.stringify(answer),
            refusalReason: answer.outcome.refusalReason,
          },
        },
        { answer },
      ],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    expect(result.status).toBe('REFUSED');
    const offered = model.doGenerateCalls.map((_, index) => toolsOfferedAt(model, index)).flat();
    expect(offered).not.toContain('search_rate_card');
    expect(offered).not.toContain('lookup_inventory');
    expect(offered).not.toContain('calculate_quote');

    const saved = await testDb.prisma.assessment.findUnique({ where: { runId: result.runId } });
    expect(saved?.quoteCents).toBeNull();
  });

  it('will not let a second policy check reopen pricing on a refused run', async () => {
    const caseId = await openCase(CASINO.id);
    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'gambling' } },
        // Refused, so try again with something the policy allows and carry on to a quote.
        { call: 'check_ad_policy', input: { vertical: 'retail' } },
        {
          call: 'lookup_inventory',
          input: { packageId: 'rate-display-ros', requestedVolume: 1_000_000 },
        },
      ],
      repeatLast: true,
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 4 });

    const offered = model.doGenerateCalls.map((_, index) => toolsOfferedAt(model, index)).flat();
    expect(offered).not.toContain('lookup_inventory');
    expect(offered).not.toContain('calculate_quote');

    const steps = await listRunSteps(result.runId, testDb.prisma);
    const inventory = steps.find((step) => step.toolName === 'lookup_inventory');
    expect(inventory?.error).not.toBeNull();
    expect(inventory?.output).toBeNull();
  });

  it('sends a review vertical to a human', async () => {
    const caseId = await openCase(CRYPTO.id);
    const answer = {
      summary: 'Cryptocurrency exchange: compliance review needed before we respond.',
      outcome: {
        disposition: 'NEEDS_REVIEW',
        brief: { ...briefFor('CoinWave', 'cryptocurrency'), channel: 'video' as const },
        reviewReason: 'Cryptocurrency offers require legal review before acceptance.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'cryptocurrency' } },
        {
          call: 'save_case',
          input: {
            disposition: 'NEEDS_REVIEW',
            summary: answer.summary,
            structured: JSON.stringify(answer),
          },
        },
        { answer },
      ],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });
    expect(result.status).toBe('NEEDS_HUMAN');
  });
});

describe('executeRun — a model that does not cooperate', () => {
  it('does not execute a tool the current phase forbids, and records the attempt', async () => {
    const caseId = await openCase(BRIEF.id);
    const model = scriptedModel({
      steps: [
        {
          // Pricing, on the first step, before policy has been checked.
          call: 'calculate_quote',
          input: { lineItems: [{ packageId: 'rate-display-ros', requestedVolume: 1_000_000 }] },
        },
      ],
      repeatLast: true,
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 3 });

    expect(result.status).toBe('FAILED');
    const steps = await listRunSteps(result.runId, testDb.prisma);
    const quoteAttempts = steps.filter((step) => step.toolName === 'calculate_quote');
    expect(quoteAttempts.length).toBeGreaterThan(0);
    // Recorded as an error, with no output: the tool never ran.
    expect(quoteAttempts.every((step) => step.error !== null && step.output === null)).toBe(true);
    expect(await testDb.prisma.assessment.count({ where: { runId: result.runId } })).toBe(0);
  });

  it('stops at the step budget and fails, naming budget exhaustion', async () => {
    const caseId = await openCase(BRIEF.id);
    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'automotive' } }],
      repeatLast: true,
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 4 });

    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/budget exhausted/i);
    expect(model.doGenerateCalls).toHaveLength(4);
    expect(await testDb.prisma.assessment.count({ where: { runId: result.runId } })).toBe(0);
  });

  it('fails rather than persisting a final answer that does not match the schema', async () => {
    const caseId = await openCase(BRIEF.id);
    const model = scriptedModel({
      steps: [{ answer: { summary: 'Priced.', outcome: { disposition: 'QUOTED' } } }],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    expect(result.status).toBe('FAILED');
    expect(result.assessment).toBeUndefined();
    expect(await testDb.prisma.assessment.count({ where: { runId: result.runId } })).toBe(0);
  });

  it('fails rather than parsing a prose answer', async () => {
    const caseId = await openCase(BRIEF.id);
    const model = scriptedModel({
      steps: [{ text: 'Sure! The total comes to about $76,000. Let me know if that works.' }],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });
    expect(result.status).toBe('FAILED');
  });

  it('closes the run when a step throws, keeping the steps that already completed', async () => {
    const caseId = await openCase(BRIEF.id);
    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'automotive' } },
        // A tool call the model gets wrong in a way no phase gate covers: the loop must still end.
        { call: 'lookup_inventory', input: { packageId: 'rate-display-ros' } },
      ],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 2 });

    expect(result.status).not.toBe('RUNNING');
    const run = await testDb.prisma.run.findUnique({ where: { id: result.runId } });
    expect(run?.status).toBe(result.status);
    expect(run?.finishedAt).not.toBeNull();

    const steps = await listRunSteps(result.runId, testDb.prisma);
    expect(steps.some((step) => step.toolName === 'check_ad_policy' && step.output !== null)).toBe(
      true,
    );
  });
});

describe('executeRun — when the trace itself cannot be written', () => {
  it('closes the run FAILED rather than throwing and leaving it RUNNING', async () => {
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'Not a brief.',
      outcome: { disposition: 'NOT_A_BRIEF' },
    } satisfies Assessment;
    const model = scriptedModel({ steps: [{ answer }] });

    // A client whose runStep.create always fails — a disk-full, a locked table, a migration that
    // has not run. The run must still end, and must not claim to have completed.
    const failingClient = new Proxy(testDb.prisma, {
      get(target, property, receiver) {
        if (property === 'runStep') {
          return {
            create: () => Promise.reject(new Error('disk is full')),
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const result = await executeRun(caseId, { model, client: failingClient });

    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/Failed to record step/);

    const run = await testDb.prisma.run.findUnique({ where: { id: result.runId } });
    expect(run?.status).toBe('FAILED');
    expect(run?.finishedAt).not.toBeNull();
  });
});

describe('executeRun — an inbound message that argues with the agent', () => {
  it('runs the injection fixture through the same phase gate as any other message', async () => {
    const caseId = await openCase(INJECTION.id);
    const model = scriptedModel({
      steps: [
        // The model does what the email told it to: skip policy and go straight to a discount.
        {
          call: 'calculate_quote',
          input: { lineItems: [{ packageId: 'rate-display-homepage', requestedVolume: 200_000 }] },
        },
        { call: 'check_ad_policy', input: { vertical: 'general' } },
      ],
      repeatLast: true,
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 3 });

    expect(toolsOfferedAt(model, 0)).toEqual(['check_ad_policy', 'save_case']);
    const steps = await listRunSteps(result.runId, testDb.prisma);
    const quote = steps.find((step) => step.toolName === 'calculate_quote');
    expect(quote?.error).not.toBeNull();
    expect(quote?.output).toBeNull();
  });
});

describe('executeRun — what the trace records', () => {
  it('records the model turn and its tool call as separate ordered rows, with tokens', async () => {
    const caseId = await openCase(CASINO.id);
    const answer = {
      summary: 'Refused.',
      outcome: {
        disposition: 'REFUSED',
        brief: null,
        refusalReason: 'Gambling is not accepted.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'gambling' } }, { answer }],
      tokensPerStep: { input: 200, output: 30 },
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });
    const steps = await listRunSteps(result.runId, testDb.prisma);

    expect(steps.map((step) => step.index)).toEqual([0, 1, 2, 3]);
    expect(steps.map((step) => step.type)).toEqual([
      'MODEL_CALL',
      'TOOL_CALL',
      'MODEL_CALL',
      'TERMINAL',
    ]);
    expect(steps[1].toolName).toBe('check_ad_policy');
    expect(JSON.parse(steps[1].output ?? 'null')).toMatchObject({ ok: true });

    const modelCalls = steps.filter((step) => step.type === 'MODEL_CALL');
    expect(modelCalls.every((step) => step.tokens === 230)).toBe(true);

    const run = await testDb.prisma.run.findUnique({ where: { id: result.runId } });
    expect(run?.totalTokens).toBe(460);
    expect(run?.modelId).toBe('mock-model');
    expect(run?.promptVersion).toBe('v1');
    expect(run?.maxSteps).toBeGreaterThan(0);
  });
});

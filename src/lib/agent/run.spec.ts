import type { Prisma } from '@prisma/client';
import { SEED } from '../../../prisma/seed-data';
import { scriptedModel, toolsOfferedAt } from '@/lib/testing/mockModel';
import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { openCaseOrThrow, seedAll } from '@/lib/testing/testFixtures';
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

function openCase(messageId: string): Promise<string> {
  return openCaseOrThrow(testDb.prisma, messageId);
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
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 800_000 },
          ],
          totalCents: 800_000,
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
            quoteCents: 800_000,
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
    expect(saved?.quoteCents).toBe(800_000);
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
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 800_000 },
          ],
          totalCents: 800_000,
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

    expect(toolsOfferedAt(model, 0)).toEqual(['check_ad_policy']);
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

describe('executeRun — code has the last word over the model', () => {
  it('refuses a run the policy refused, whatever disposition the model returns', async () => {
    const caseId = await openCase(CASINO.id);
    // The model ignores the REFUSE and quotes anyway, with a total it invented.
    const answer = {
      summary: 'Priced the casino campaign.',
      outcome: {
        disposition: 'QUOTED',
        brief: briefFor('LuckySpin', 'gambling'),
        quote: {
          lineItems: [
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 800_000 },
          ],
          totalCents: 800_000,
        },
        draftReply: 'Happy to book this in.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'gambling' } }, { answer }],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    // The status answers "what happened to this enquiry" …
    expect(result.status).toBe('REFUSED');
    // … and the violations answer "what did the agent get wrong". An operator needs both.
    expect(result.violations.map((violation) => violation.check)).toEqual(
      expect.arrayContaining(['QUOTE_HAS_A_CALCULATION', 'DISPOSITION_MATCHES_POLICY']),
    );

    expect(await testDb.prisma.assessment.count({ where: { runId: result.runId } })).toBe(0);
    const run = await testDb.prisma.run.findUnique({ where: { id: result.runId } });
    expect(run?.status).toBe('REFUSED');
  });

  it('records which rule refused and about what, not merely that a refusal happened', async () => {
    const caseId = await openCase(CASINO.id);
    const answer = {
      summary: 'Gambling is not accepted.',
      outcome: {
        disposition: 'REFUSED',
        brief: briefFor('LuckySpin', 'gambling'),
        refusalReason: 'Gambling is not accepted on this network.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'gambling' } }, { answer }],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });
    expect(result.status).toBe('REFUSED');
    expect(result.violations).toEqual([]);

    const steps = await listRunSteps(result.runId, testDb.prisma);
    const terminal = steps.find((step) => step.type === 'TERMINAL');
    const recorded = JSON.parse(terminal?.output ?? '{}') as {
      refusal?: { ruleId: string; vertical: string };
    };
    expect(recorded.refusal?.ruleId).toBe('policy-gambling');
    expect(recorded.refusal?.vertical).toBe('gambling');
  });

  it('fails a run whose answer the tool results contradict', async () => {
    const caseId = await openCase(BRIEF.id);
    // Policy allows and a quote really was calculated — but the answer reports a different total.
    const answer = {
      summary: 'Priced.',
      outcome: {
        disposition: 'QUOTED',
        brief: briefFor('North Road Autos', 'automotive'),
        quote: {
          lineItems: [
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 999_999 },
          ],
          totalCents: 999_999,
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

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    expect(result.status).toBe('FAILED');
    expect(result.violations.map((violation) => violation.check)).toContain(
      'QUOTE_TOTAL_MATCHES_CALCULATION',
    );
    // The recorded reason names both numbers, so an operator does not have to diff the trace.
    expect(result.error).toContain('999999');
    expect(result.error).toContain('800000');
  });

  it('fails a run reporting a vertical that was never assessed', async () => {
    const caseId = await openCase(BRIEF.id);
    const contradictory = {
      summary: 'Priced.',
      outcome: {
        disposition: 'NEEDS_REVIEW',
        // policy was asked about 'automotive'; the assessment reports something else entirely
        brief: briefFor('North Road Autos', 'pharmaceuticals'),
        reviewReason: 'Needs a second look.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'automotive' } },
        { answer: contradictory },
      ],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    expect(result.status).toBe('FAILED');
    expect(result.violations.map((violation) => violation.check)).toContain(
      'VERTICAL_WAS_ASSESSED',
    );
  });

  it('still refuses when the refused run then exhausts its budget', async () => {
    const caseId = await openCase(CASINO.id);
    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'gambling' } }],
      repeatLast: true,
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 3 });

    // The enquiry was refused; the run also failed to finish. The status reports the first, the
    // error the second, so an operator does not retry a settled policy decision.
    expect(result.status).toBe('REFUSED');
    expect(result.error).toMatch(/budget exhausted/i);
  });

  it('fails a refused run whose trace could not be written, since nothing can be vouched for', async () => {
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
    });

    const failingClient = new Proxy(testDb.prisma, {
      get(target, property, receiver) {
        if (property === 'runStep') {
          return { create: () => Promise.reject(new Error('disk is full')) };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const result = await executeRun(caseId, { model, client: failingClient });
    expect(result.status).toBe('FAILED');
  });

  it('fails a refusal the model asserted but no policy decision supports', async () => {
    // REFUSED can arrive two ways: the policy engine refused, or the model simply said so. Only
    // the first is a refusal. A guard that tested the resulting status rather than the evidence
    // would let the second skip the fail-closed step and be recorded as though policy had settled
    // it — an unbacked refusal, indistinguishable in the run row from an enforced one.
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'Refusing this one.',
      outcome: {
        disposition: 'REFUSED',
        brief: briefFor('North Road Autos', 'gambling'), // policy was asked about automotive
        refusalReason: 'I decided not to.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'automotive' } }, { answer }],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });

    expect(result.status).toBe('FAILED');
    expect(result.violations.map((violation) => violation.check)).toContain(
      'VERTICAL_WAS_ASSESSED',
    );
  });

  it('fails when the terminal row itself cannot be written', async () => {
    // Precedence rule 1 has to cover the terminal row too — it is the row an operator reads
    // first, so a run that lost it cannot be vouched for either.
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'Not a brief.',
      outcome: { disposition: 'NOT_A_BRIEF' },
    } satisfies Assessment;
    const model = scriptedModel({ steps: [{ answer }] });

    let calls = 0;
    const failsOnTerminalWrite = new Proxy(testDb.prisma, {
      get(target, property, receiver) {
        if (property !== 'runStep') return Reflect.get(target, property, receiver) as unknown;
        return {
          create: (args: Prisma.RunStepCreateArgs) => {
            calls += 1;
            return args.data.type === 'TERMINAL'
              ? Promise.reject(new Error('disk is full'))
              : testDb.prisma.runStep.create(args);
          },
        };
      },
    });

    const result = await executeRun(caseId, { model, client: failsOnTerminalWrite });

    expect(calls).toBeGreaterThan(0);
    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/Failed to record step/);
  });

  it('records both a post-condition failure and a lost trace, not just the first', async () => {
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'Priced.',
      outcome: {
        disposition: 'QUOTED',
        brief: briefFor('North Road Autos', 'automotive'),
        quote: {
          lineItems: [
            { packageId: 'rate-display-ros', requestedVolume: 1_000_000, totalCents: 999_999 },
          ],
          totalCents: 999_999,
        },
        draftReply: 'Draft.',
      },
    } satisfies Assessment;
    const model = scriptedModel({ steps: [{ answer }] });

    const failingClient = new Proxy(testDb.prisma, {
      get(target, property, receiver) {
        if (property === 'runStep') {
          return { create: () => Promise.reject(new Error('disk is full')) };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const result = await executeRun(caseId, { model, client: failingClient });

    expect(result.status).toBe('FAILED');
    // An operator told only about the violations would open a trace with steps silently missing.
    expect(result.error).toMatch(/QUOTE_HAS_A_CALCULATION/);
    expect(result.error).toMatch(/Failed to record step/);
  });

  it('leaves a clean run alone', async () => {
    const caseId = await openCase(CRYPTO.id);
    const answer = {
      summary: 'Crypto exchange: compliance review needed.',
      outcome: {
        disposition: 'NEEDS_REVIEW',
        brief: { ...briefFor('CoinWave', 'cryptocurrency'), channel: 'video' as const },
        reviewReason: 'Cryptocurrency offers require legal review.',
      },
    } satisfies Assessment;

    const model = scriptedModel({
      steps: [{ call: 'check_ad_policy', input: { vertical: 'cryptocurrency' } }, { answer }],
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma });
    expect(result.status).toBe('NEEDS_HUMAN');
    expect(result.violations).toEqual([]);
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

describe('executeRun — onRunStarted', () => {
  it('fires once, synchronously with createRun, before the model is ever called', async () => {
    const caseId = await openCase(BRIEF.id);
    const answer = {
      summary: 'Not a brief.',
      outcome: { disposition: 'NOT_A_BRIEF' },
    } satisfies Assessment;
    const model = scriptedModel({ steps: [{ answer }] });

    const seen: string[] = [];
    const result = await executeRun(caseId, {
      model,
      client: testDb.prisma,
      onRunStarted: (runId) => {
        seen.push(runId);
        // The model has not been called yet: this fires before generateText's first step.
        expect(model.doGenerateCalls).toHaveLength(0);
      },
    });

    expect(seen).toEqual([result.runId]);
  });

  it('does not fire twice, even on a run that fails', async () => {
    const caseId = await openCase(BRIEF.id);
    const model = scriptedModel({ steps: [{ text: 'not json' }] });
    let calls = 0;

    await executeRun(caseId, {
      model,
      client: testDb.prisma,
      onRunStarted: () => {
        calls += 1;
      },
    });

    expect(calls).toBe(1);
  });
});

describe('executeRun — caseForRun', () => {
  it('uses a pre-fetched case instead of querying for it again', async () => {
    const caseId = await openCase(BRIEF.id);
    const caseForRun = { id: caseId, inboundMessage: BRIEF };
    const answer = {
      summary: 'Not a brief.',
      outcome: { disposition: 'NOT_A_BRIEF' },
    } satisfies Assessment;
    const model = scriptedModel({ steps: [{ answer }] });

    const noCaseReads = new Proxy(testDb.prisma, {
      get(target, prop, receiver) {
        if (prop === 'case') throw new Error('executeRun queried the case despite caseForRun');
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    const result = await executeRun(caseId, { model, client: noCaseReads, caseForRun });

    expect(result.status).toBe('COMPLETED');
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

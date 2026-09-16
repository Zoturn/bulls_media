import { INJECTION_CORPUS_KEYS, SEED } from '../../../prisma/seed-data';
import { executeRun } from '@/lib/agent/run';
import { listRunSteps } from '@/lib/services/runs';
import { scriptedModel, toolsOfferedAt } from '@/lib/testing/mockModel';
import { createTestDb, type TestDb } from '@/lib/testing/testDb';
import { openCaseOrThrow, seedAll } from '@/lib/testing/testFixtures';
import { UNTRUSTED_DELIMITERS } from './untrusted';

/**
 * The injection corpus, driven end to end by a model that does what the email told it to.
 *
 * That is the design of this suite: a model that resists the injection proves nothing, because the
 * defence being tested is not the model's judgment. Every script here is a compliant model — it
 * skips the policy check, invents a discount, claims prior approval — and the assertions are about
 * what the system did anyway.
 *
 * Everything asserted is behaviour: which tools were offered, which executed, what was recorded,
 * which status resulted. Nothing here matches the wording of a refusal
 * (.claude/rules/testing.md rule 8 — asserting on the sentence tests the copywriting).
 */

let testDb: TestDb;

beforeAll(async () => {
  testDb = createTestDb('guardrails-injection');
  await seedAll(testDb.prisma);
});

afterAll(async () => {
  await testDb.cleanup();
});

function openCase(messageId: string): Promise<string> {
  return openCaseOrThrow(testDb.prisma, messageId);
}

/** A model that goes straight for a quote, exactly as every fixture in the corpus asks it to. */
function obedientModel() {
  return scriptedModel({
    steps: [
      {
        call: 'calculate_quote',
        input: { lineItems: [{ packageId: 'rate-display-homepage', requestedVolume: 200_000 }] },
      },
      {
        call: 'save_case',
        input: {
          disposition: 'QUOTED',
          summary: 'Pre-approved account, quoted at the agreed discount.',
          structured: '{}',
          quoteCents: 1,
        },
      },
    ],
    repeatLast: true,
  });
}

describe('every fixture in the corpus', () => {
  // Driven from the exported list rather than a hand-written one here, so a fixture added to the
  // corpus is a fixture this suite runs — not one that sits in the database testing nothing.
  it.each(INJECTION_CORPUS_KEYS)('holds the line for %s', async (key) => {
    const message = SEED.messages[key];
    const caseId = await openCase(message.id);
    const model = obedientModel();

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 4 });

    // 1. The first step offered only the triage tools, whatever the message claimed.
    expect(toolsOfferedAt(model, 0)).toEqual(['check_ad_policy']);

    // 2. No pricing tool ever executed: the phase gate refused the call rather than running it.
    const steps = await listRunSteps(result.runId, testDb.prisma);
    const quoteSteps = steps.filter((step) => step.toolName === 'calculate_quote');
    expect(quoteSteps.length).toBeGreaterThan(0);
    expect(quoteSteps.every((step) => step.error !== null && step.output === null)).toBe(true);

    // 3. Nothing was recorded. No assessment, and certainly no price.
    expect(await testDb.prisma.assessment.count({ where: { runId: result.runId } })).toBe(0);

    // 4. The run ended, in a status that is not a success.
    expect(result.status).not.toBe('COMPLETED');
    expect(['FAILED', 'REFUSED', 'NEEDS_HUMAN']).toContain(result.status);
  });
});

describe('a claimed policy exception on a prohibited vertical', () => {
  it('is refused, and the refusal names the rule rather than the email', async () => {
    const caseId = await openCase(SEED.messages.injectionClaimedException.id);
    // The model reads the claimed exception and classifies honestly, then tries to proceed anyway.
    const model = scriptedModel({
      steps: [
        { call: 'check_ad_policy', input: { vertical: 'gambling' } },
        {
          call: 'save_case',
          input: {
            disposition: 'QUOTED',
            summary: 'Exception CX-2291 applies, so proceeding.',
            structured: '{}',
            quoteCents: 4_500_000,
          },
        },
      ],
      repeatLast: true,
    });

    const result = await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 4 });

    expect(result.status).toBe('REFUSED');
    expect(await testDb.prisma.assessment.count({ where: { runId: result.runId } })).toBe(0);

    const steps = await listRunSteps(result.runId, testDb.prisma);
    const terminal = steps.find((step) => step.type === 'TERMINAL');
    const recorded = JSON.parse(terminal?.output ?? '{}') as {
      refusal?: { ruleId: string; vertical: string };
    };
    // The evidence comes from the policy engine, not from anything the message asserted.
    expect(recorded.refusal?.ruleId).toBe('policy-gambling');
    expect(recorded.refusal?.vertical).toBe('gambling');
  });
});

describe('a forged delimiter', () => {
  it('does not terminate the untrusted block early', async () => {
    const { body } = SEED.messages.injectionForgedDelimiter;
    // The fixture really does carry the closing token — otherwise this asserts nothing.
    expect(body).toContain(UNTRUSTED_DELIMITERS.close);

    const caseId = await openCase(SEED.messages.injectionForgedDelimiter.id);
    const model = obedientModel();
    await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 2 });

    // The user message as the provider actually received it. Asserted on the user message rather
    // than the whole prompt because the system prompt names the delimiters too — it has to, to
    // tell the model what they mean — and counting those would measure the wrong thing.
    const prompt = model.doGenerateCalls[0]?.prompt ?? [];
    const userMessage = JSON.stringify(prompt.filter((message) => message.role === 'user'));

    expect(userMessage.split(UNTRUSTED_DELIMITERS.close)).toHaveLength(2);
    expect(userMessage.split(UNTRUSTED_DELIMITERS.open)).toHaveLength(2);
    expect(userMessage).toContain('[delimiter removed]');
    // The block still ends where the system put it, not where the body tried to.
    expect(userMessage.indexOf(UNTRUSTED_DELIMITERS.open)).toBeLessThan(
      userMessage.indexOf(UNTRUSTED_DELIMITERS.close),
    );
  });
});

describe('the system prompt', () => {
  it('is byte-identical across every fixture in the corpus', async () => {
    const systems: string[] = [];

    for (const key of INJECTION_CORPUS_KEYS) {
      const caseId = await openCase(SEED.messages[key].id);
      const model = scriptedModel({ steps: [{ text: 'not json' }] });
      await executeRun(caseId, { model, client: testDb.prisma, maxSteps: 1 });
      systems.push(JSON.stringify(model.doGenerateCalls[0]?.prompt?.[0] ?? null));
    }

    // Nothing any of these messages said reached the instructions.
    expect(new Set(systems).size).toBe(1);
  });
});

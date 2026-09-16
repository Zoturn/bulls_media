import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient, type Assessment as AssessmentRow } from '@prisma/client';
import { SEED } from '../prisma/seed-data';
import { seedDatabase } from '../prisma/seed-lib';
import { executeRun, type Assessment, type ExtractedBrief } from '../src/lib/agent';
import { listRunSteps, type RunStepRecord } from '../src/lib/services/runs';
import { scriptedModel, type ScriptedStep } from '../src/lib/testing/mockModel';
import { migrateSqliteDatabase, removeDbFiles } from '../src/lib/testing/testDbTemplate';
import { openCaseOrThrow } from '../src/lib/testing/testFixtures';
import { formatCents } from '../src/components/console/format';

/**
 * Regenerates every file under `examples/` from a real run of the real orchestrator against the
 * real deterministic tools — the seeded rate card and policy table compute the same answers here
 * they would for a live call. Only the model is scripted, standing in for the one part of a real
 * model's behaviour this project cannot pin down: which tool it calls, in what order, and its own
 * prose. See openspec/changes/add-docs-and-verification/design.md for why.
 *
 * Run by hand — `npm run examples:generate` — against a disposable database this script builds
 * and tears down itself, never `dev.db` and never Jest's own test-database template.
 */

const PROJECT_ROOT = path.join(__dirname, '..');
const EXAMPLES_DIR = path.join(PROJECT_ROOT, 'examples');

interface CaseExample {
  slug: string;
  title: string;
  messageKey: keyof typeof SEED.messages;
  steps: ScriptedStep[];
}

const briefFor = (
  advertiser: string,
  vertical: string,
  overrides: Partial<ExtractedBrief> = {},
): ExtractedBrief => ({
  advertiser,
  vertical,
  channel: 'display',
  budgetCents: null,
  requestedVolume: null,
  flightDays: null,
  ...overrides,
});

const EXAMPLES: CaseExample[] = [
  {
    slug: '01-ordinary-brief-quoted',
    title: 'A complete brief in a permitted vertical',
    messageKey: 'ordinaryBrief',
    steps: (() => {
      const packageId = 'rate-display-ros';
      const requestedVolume = 1_000_000;
      const totalCents = 800_000;
      const draftReply =
        'Hi Priya — for the spring campaign we can offer 1,000,000 impressions of Run of Site ' +
        'Display for $8,000, within your April 1–30 window. Let us know if you would like to ' +
        'proceed.';
      const answer: Assessment = {
        summary: 'North Road Autos want display and video for a spring sale; quoted.',
        outcome: {
          disposition: 'QUOTED',
          brief: briefFor('North Road Autos', 'automotive', {
            budgetCents: 1_800_000,
            requestedVolume,
            flightDays: 30,
          }),
          quote: { lineItems: [{ packageId, requestedVolume, totalCents }], totalCents },
          draftReply,
        },
      };
      return [
        { call: 'check_ad_policy', input: { vertical: 'automotive' } },
        { call: 'search_rate_card', input: { query: 'display run of site', channel: 'display' } },
        { call: 'lookup_inventory', input: { packageId, requestedVolume } },
        { call: 'calculate_quote', input: { lineItems: [{ packageId, requestedVolume }] } },
        {
          call: 'save_case',
          input: {
            disposition: 'QUOTED',
            summary: answer.summary,
            structured: JSON.stringify(answer),
            quoteCents: totalCents,
            draftReply,
          },
        },
        { answer },
      ];
    })(),
  },
  {
    slug: '02-prohibited-vertical-refused',
    title: 'A brief in a prohibited vertical',
    messageKey: 'prohibitedVertical',
    steps: (() => {
      const refusalReason = 'Gambling and betting advertising is not accepted on this network.';
      const answer: Assessment = {
        summary: 'Online casino: gambling is not accepted on this network.',
        outcome: {
          disposition: 'REFUSED',
          brief: briefFor('LuckySpin', 'gambling', { budgetCents: 5_000_000 }),
          refusalReason,
        },
      };
      return [
        { call: 'check_ad_policy', input: { vertical: 'gambling' } },
        {
          call: 'save_case',
          input: {
            disposition: 'REFUSED',
            summary: answer.summary,
            structured: JSON.stringify(answer),
            refusalReason,
          },
        },
        { answer },
      ];
    })(),
  },
  {
    slug: '03-review-vertical-needs-review',
    title: 'A brief in a vertical requiring review',
    messageKey: 'reviewVertical',
    steps: (() => {
      const answer: Assessment = {
        summary: 'Cryptocurrency exchange: compliance review needed before we respond.',
        outcome: {
          disposition: 'NEEDS_REVIEW',
          brief: briefFor('CoinWave', 'cryptocurrency', {
            channel: 'video',
            budgetCents: 3_000_000,
          }),
          reviewReason: 'Cryptocurrency offers require legal review before acceptance.',
        },
      };
      return [
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
      ];
    })(),
  },
  {
    slug: '04-injection-attempt-unchanged-workflow',
    title: 'A message carrying instructions aimed at the agent',
    messageKey: 'injectionAttempt',
    steps: (() => {
      // The email demands a 90% discount and asks to skip both policy and human review. Neither
      // is honoured: the workflow below is the same one an ordinary brief in an unlisted vertical
      // gets — check policy, price at the real rate card, stop for approval like anything else.
      const packageId = 'rate-display-ros';
      const requestedVolume = 1_000_000;
      const totalCents = 800_000;
      const draftReply =
        'Hi Alex — we can offer 1,000,000 impressions of Run of Site Display for $8,000, at ' +
        'our standard rate. This is pending internal approval before it is confirmed.';
      const answer: Assessment = {
        summary: 'Display campaign enquiry; priced at standard rates, pending approval.',
        outcome: {
          disposition: 'QUOTED',
          brief: briefFor('Prime Offers', 'general', {
            budgetCents: 1_200_000,
            requestedVolume,
            flightDays: 30,
          }),
          quote: { lineItems: [{ packageId, requestedVolume, totalCents }], totalCents },
          draftReply,
        },
      };
      return [
        { call: 'check_ad_policy', input: { vertical: 'general' } },
        { call: 'search_rate_card', input: { query: 'display', channel: 'display' } },
        { call: 'lookup_inventory', input: { packageId, requestedVolume } },
        { call: 'calculate_quote', input: { lineItems: [{ packageId, requestedVolume }] } },
        {
          call: 'save_case',
          input: {
            disposition: 'QUOTED',
            summary: answer.summary,
            structured: JSON.stringify(answer),
            quoteCents: totalCents,
            draftReply,
          },
        },
        { answer },
      ];
    })(),
  },
  {
    slug: '05-not-a-brief-early-exit',
    title: 'A message that is not an advertising brief',
    messageKey: 'notABrief',
    steps: (() => {
      const answer: Assessment = {
        summary:
          'This is a payment-status follow-up on an existing invoice, not an advertising enquiry.',
        outcome: { disposition: 'NOT_A_BRIEF' },
      };
      // No tool call at all: the classifier's own job is to not spend steps on extraction or
      // pricing when there is nothing to extract or price.
      return [{ answer }];
    })(),
  },
  {
    slug: '06-missing-budget-needs-info',
    title: 'A brief missing what is needed to quote',
    messageKey: 'missingBudget',
    steps: (() => {
      const draftReply =
        'Hi Jordan — thanks for reaching out. Could you share a rough budget for the campaign ' +
        'so we can put together package options for you?';
      const answer: Assessment = {
        summary: 'Brightleaf Home wants display ads but has not given a budget yet.',
        outcome: {
          disposition: 'NEEDS_INFO',
          brief: briefFor('Brightleaf Home', 'retail'),
          missingFields: ['budgetCents'],
          draftReply,
        },
      };
      return [
        { call: 'check_ad_policy', input: { vertical: 'retail' } },
        {
          call: 'save_case',
          input: {
            disposition: 'NEEDS_INFO',
            summary: answer.summary,
            structured: JSON.stringify(answer),
            draftReply,
          },
        },
        { answer },
      ];
    })(),
  },
];

function fence(value: string): string {
  return '```json\n' + value + '\n```';
}

/** Pretty-prints a JSON string, or returns it unchanged if it does not parse. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function renderStep(step: RunStepRecord): string {
  const lines = [
    `### Step ${step.index + 1} — ${step.type}${step.toolName ? `: \`${step.toolName}\`` : ''}`,
  ];
  // Not `step.durationMs`: it is real wall-clock timing, which is noise here — every
  // regeneration would touch every line of every file, for a number that says nothing about
  // what the case demonstrates. `tokens` (the mock model's own fixed per-step count) is stable.
  if (step.tokens !== null) lines.push(`_${step.tokens} tokens_`);
  if (step.input !== null) lines.push('', 'Input:', '', fence(prettyJson(step.input)));
  if (step.output !== null) {
    lines.push('', 'Output:', '', fence(prettyJson(step.output)));
  }
  if (step.error !== null) lines.push('', `**Error:** ${step.error}`);
  return lines.join('\n');
}

function renderMarkdown(
  example: CaseExample,
  message: (typeof SEED.messages)[keyof typeof SEED.messages],
  status: string,
  steps: RunStepRecord[],
  assessment: AssessmentRow | null,
): string {
  const lines: string[] = [
    `# ${example.title}`,
    '',
    `Generated by \`npm run examples:generate\` from the seeded message \`${message.id}\`. Tool ` +
      'results below came from the real deterministic engines against the seeded rate card and ' +
      'policy table; only the model’s choice of which tool to call, in what order, and its ' +
      'own prose were scripted, for the reasons in ' +
      '[design.md](../openspec/changes/archive/2026-09-16-add-docs-and-verification/design.md).',
    '',
    '## Inbound message',
    '',
    `**From:** ${message.fromName} <${message.fromAddress}>`,
    `**Subject:** ${message.subject}`,
    '',
    '> ' + message.body.replaceAll('\n', '\n> '),
    '',
    `## Trace (run status: \`${status}\`)`,
    '',
  ];

  for (const step of steps) {
    lines.push(renderStep(step), '');
  }

  lines.push('## Assessment');
  lines.push('');
  if (assessment === null) {
    lines.push('No assessment was saved for this run.');
  } else {
    lines.push(`**Disposition:** \`${assessment.disposition}\``, '', assessment.summary, '');
    if (assessment.refusalReason !== null) {
      lines.push(`**Why:** ${assessment.refusalReason}`, '');
    }
    if (assessment.quoteCents !== null) {
      lines.push(`**Total:** ${formatCents(assessment.quoteCents)}`, '');
    }
    if (assessment.draftReply !== null) {
      lines.push('**Draft reply:**', '', '> ' + assessment.draftReply.replaceAll('\n', '\n> '), '');
    }
    lines.push('<details><summary>Structured result</summary>', '');
    lines.push(fence(prettyJson(assessment.structured)));
    lines.push('', '</details>');
  }

  return lines.join('\n') + '\n';
}

async function generateOne(prisma: PrismaClient, example: CaseExample): Promise<void> {
  const message = SEED.messages[example.messageKey];
  const caseId = await openCaseOrThrow(prisma, message.id);

  const model = scriptedModel({ steps: example.steps });
  const result = await executeRun(caseId, { model, client: prisma });
  const steps = await listRunSteps(result.runId, prisma);
  const assessment = await prisma.assessment.findUnique({ where: { runId: result.runId } });

  const markdown = renderMarkdown(example, message, result.status, steps, assessment);
  writeFileSync(path.join(EXAMPLES_DIR, `${example.slug}.md`), markdown);
  console.log(`wrote examples/${example.slug}.md (${result.status})`);
}

async function main(): Promise<void> {
  const dbPath = path.join(os.tmpdir(), `inbound-brief-desk-examples-${process.pid}.db`);
  removeDbFiles(dbPath);
  migrateSqliteDatabase(dbPath, 'inherit');

  const prisma = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  try {
    await seedDatabase(prisma);
    if (!existsSync(EXAMPLES_DIR)) mkdirSync(EXAMPLES_DIR);

    for (const example of EXAMPLES) {
      await generateOne(prisma, example);
    }
  } finally {
    await prisma.$disconnect();
    removeDbFiles(dbPath);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

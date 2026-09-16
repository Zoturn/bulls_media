import { z } from 'zod';
import {
  approvalDecisionSchema,
  assessmentDispositionSchema,
  caseStatusSchema,
  runStatusSchema,
} from '@/lib/domain/enums';
import { AGENT_PHASES } from '@/lib/agent/phases';
import { postConditionViolationSchema } from '@/lib/guardrails/postconditions';
import type { InboxRow, CaseDetailRow } from '@/lib/services/consoleReads';
import type { RunStepRecord } from '@/lib/services/runs';

/**
 * What the console's HTTP surface sends and accepts, as schemas rather than hand-written
 * interfaces — the same discipline every tool in `src/lib/tools/**` applies to its own output
 * (.claude/rules/typescript.md rule 3). A route handler builds a DTO with the matching `to*`
 * function below and `.parse()`s it before responding; the client's fetch wrapper in
 * `src/lib/query/api.ts` parses the same schema against what it receives. One definition, both
 * ends of the wire.
 *
 * Every date crossing this boundary is a `z.string()` (ISO), never `z.date()`: by the time a
 * response has gone through `NextResponse.json` and a `fetch().json()` on the other end, a `Date`
 * is already a string — the schema describes what actually arrives, not what Prisma returned.
 */

// ---------------------------------------------------------------------------------------------
// Read DTOs
// ---------------------------------------------------------------------------------------------

export const inboxEntrySchema = z.object({
  messageId: z.string(),
  fromName: z.string(),
  fromAddress: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  case: z
    .object({
      id: z.string(),
      status: caseStatusSchema,
      latestRunStatus: runStatusSchema.nullable(),
    })
    .nullable(),
});
export type InboxEntry = z.infer<typeof inboxEntrySchema>;

export const inboxResponseSchema = z.array(inboxEntrySchema);

export const runStepDtoSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  type: z.string(),
  toolName: z.string().nullable(),
  input: z.string().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int(),
  tokens: z.number().int().nullable(),
  createdAt: z.string(),
});
export type RunStepDto = z.infer<typeof runStepDtoSchema>;

export const assessmentRecordSchema = z.object({
  id: z.string(),
  disposition: assessmentDispositionSchema,
  summary: z.string(),
  structured: z.string(),
  refusalReason: z.string().nullable(),
  quoteCents: z.number().int().nullable(),
  draftReply: z.string().nullable(),
  createdAt: z.string(),
});
export type AssessmentRecord = z.infer<typeof assessmentRecordSchema>;

export const approvalRecordSchema = z.object({
  id: z.string(),
  decision: approvalDecisionSchema.nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

/**
 * The evidence a `TERMINAL` step carries, as written by `src/lib/agent/run.ts`. This is a
 * diagnostic payload for a person, not a contract that module promises to keep field-for-field —
 * see design.md — so every field here is optional except the two the run loop always writes, and
 * a payload from before this shape existed simply parses with everything but those two absent.
 */
export const terminalStepDataSchema = z.object({
  status: runStatusSchema,
  phase: z.enum(AGENT_PHASES),
  disposition: assessmentDispositionSchema.optional(),
  refusal: z
    .object({ ruleId: z.string().nullable(), vertical: z.string(), description: z.string() })
    .optional(),
  refusalSummary: z.string().optional(),
  violations: z.array(postConditionViolationSchema).optional(),
});
export type TerminalStepData = z.infer<typeof terminalStepDataSchema>;

export const runSummarySchema = z.object({
  id: z.string(),
  status: runStatusSchema,
  modelId: z.string(),
  promptVersion: z.string(),
  maxSteps: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  totalTokens: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  steps: z.array(runStepDtoSchema),
  assessment: assessmentRecordSchema.nullable(),
  approval: approvalRecordSchema.nullable(),
  /** Parsed from the `TERMINAL` step, if one exists and its payload parses. Null otherwise. */
  diagnostics: terminalStepDataSchema.nullable(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const caseDetailSchema = z.object({
  id: z.string(),
  status: caseStatusSchema,
  createdAt: z.string(),
  message: z.object({
    id: z.string(),
    fromName: z.string(),
    fromAddress: z.string(),
    subject: z.string(),
    body: z.string(),
    receivedAt: z.string(),
  }),
  latestRun: runSummarySchema.nullable(),
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

// ---------------------------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------------------------

export const openCaseRequestSchema = z.object({
  inboundMessageId: z.string().min(1, 'inboundMessageId is required'),
});

export const approvalRequestSchema = z.object({
  decision: approvalDecisionSchema,
  decidedBy: z.string().trim().min(1, 'decidedBy is required').max(200),
  note: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------------------------
// Write response DTOs
// ---------------------------------------------------------------------------------------------

export const openCaseResponseSchema = z.object({ caseId: z.string() });
export const startRunResponseSchema = z.object({ runId: z.string() });
export const approvalResponseSchema = z.object({ approvalId: z.string() });

// ---------------------------------------------------------------------------------------------
// Builders: a `consoleReads` row in, a schema-valid DTO out.
// ---------------------------------------------------------------------------------------------

export function toInboxEntry(row: InboxRow): InboxEntry {
  return inboxEntrySchema.parse({
    messageId: row.id,
    fromName: row.fromName,
    fromAddress: row.fromAddress,
    subject: row.subject,
    receivedAt: row.receivedAt.toISOString(),
    case:
      row.case === null
        ? null
        : {
            id: row.case.id,
            status: row.case.status,
            latestRunStatus: row.case.runs[0]?.status ?? null,
          },
  });
}

function toRunStepDto(step: RunStepRecord): RunStepDto {
  return runStepDtoSchema.parse({
    id: step.id,
    index: step.index,
    type: step.type,
    toolName: step.toolName,
    input: step.input,
    output: step.output,
    error: step.error,
    durationMs: step.durationMs,
    tokens: step.tokens,
    createdAt: step.createdAt.toISOString(),
  });
}

/**
 * The `TERMINAL` step's parsed payload, or null if there is none or it does not parse — a run
 * still `RUNNING`, or a trace from before this shape existed, is not an error here.
 */
function diagnosticsOf(steps: readonly RunStepRecord[]): TerminalStepData | null {
  const terminal = steps.find((step) => step.type === 'TERMINAL');
  if (terminal?.output == null) return null;
  try {
    const parsed = terminalStepDataSchema.safeParse(JSON.parse(terminal.output));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toRunSummary(run: CaseDetailRow['runs'][number]): RunSummary {
  return runSummarySchema.parse({
    id: run.id,
    status: run.status,
    modelId: run.modelId,
    promptVersion: run.promptVersion,
    maxSteps: run.maxSteps,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    totalTokens: run.totalTokens,
    errorMessage: run.errorMessage,
    steps: run.steps.map(toRunStepDto),
    assessment:
      run.assessment === null
        ? null
        : { ...run.assessment, createdAt: run.assessment.createdAt.toISOString() },
    approval:
      run.approval === null
        ? null
        : { ...run.approval, decidedAt: run.approval.decidedAt?.toISOString() ?? null },
    diagnostics: diagnosticsOf(run.steps),
  });
}

export function toCaseDetail(row: CaseDetailRow): CaseDetail {
  return caseDetailSchema.parse({
    id: row.id,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    message: {
      id: row.inboundMessage.id,
      fromName: row.inboundMessage.fromName,
      fromAddress: row.inboundMessage.fromAddress,
      subject: row.inboundMessage.subject,
      body: row.inboundMessage.body,
      receivedAt: row.inboundMessage.receivedAt.toISOString(),
    },
    latestRun: row.runs[0] === undefined ? null : toRunSummary(row.runs[0]),
  });
}

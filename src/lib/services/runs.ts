import type { Prisma, PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import type { RunStatus, RunStepType, TerminalRunStatus } from '@/lib/domain/enums';

/**
 * Creating a run, appending its steps as they happen, and closing it exactly once.
 *
 * Steps are written one at a time rather than accumulated and flushed at the end, because the run
 * an operator most needs a trace of is the one that died halfway
 * (.claude/rules/observability.md rule 3).
 */

export interface CreateRunInput {
  caseId: string;
  modelId: string;
  promptVersion: string;
  maxSteps: number;
}

export async function createRun(
  input: CreateRunInput,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  return client.run.create({
    data: { ...input, status: 'RUNNING' },
    select: { id: true },
  });
}

export interface RecordStepInput {
  runId: string;
  index: number;
  type: RunStepType;
  toolName?: string;
  /** Already-serialised JSON. The caller owns the shape; see .claude/rules/data-model.md rule 3. */
  input?: string;
  output?: string;
  error?: string;
  durationMs: number;
  tokens?: number;
}

export async function recordStep(
  step: RecordStepInput,
  client: PrismaClient = db,
): Promise<{ id: string }> {
  // `data: step` rather than re-listing the nine fields with `?? null`: on a create, Prisma writes
  // NULL for any nullable column left out, so the mapping was restating the schema's own default.
  // `RecordStepInput` is the shape, and it is checked against the schema by the compiler.
  return client.runStep.create({ data: step, select: { id: true } });
}

export interface CloseRunInput {
  runId: string;
  status: TerminalRunStatus;
  totalTokens?: number;
  errorMessage?: string;
}

export type CloseRunResult =
  { ok: true } | { ok: false; reason: 'ALREADY_CLOSED'; status: RunStatus };

/**
 * Sets the terminal status and `finishedAt`, but only on a run still `RUNNING`. The status filter
 * is in the `updateMany` predicate rather than checked first: a second close — a `finally` racing
 * an error path, say — then changes nothing and is reported, instead of quietly overwriting the
 * status that actually explains what happened.
 */
export async function closeRun(
  input: CloseRunInput,
  client: PrismaClient = db,
): Promise<CloseRunResult> {
  const updated = await client.run.updateMany({
    where: { id: input.runId, status: 'RUNNING' },
    data: {
      status: input.status,
      finishedAt: new Date(),
      totalTokens: input.totalTokens ?? null,
      errorMessage: input.errorMessage ?? null,
    },
  });
  if (updated.count > 0) return { ok: true };

  const existing = await client.run.findUnique({
    where: { id: input.runId },
    select: { status: true },
  });
  if (existing === null) throw new Error(`closeRun: no run ${input.runId}`);
  return { ok: false, reason: 'ALREADY_CLOSED', status: existing.status as RunStatus };
}

/**
 * The one run a case can have `RUNNING` at a time — `startRun` reads this to decide whether a new
 * one may begin (.claude/rules/api-and-validation.md rule 6: two runs racing on one case produce
 * two contradictory assessments and no way to tell which was approved).
 */
export async function findActiveRunForCase(
  caseId: string,
  client: PrismaClient = db,
): Promise<{ id: string } | null> {
  return client.run.findFirst({
    where: { caseId, status: 'RUNNING' },
    select: { id: true },
  });
}

/**
 * The columns a trace reader gets. Kept as an explicit `select` per .claude/rules/data-model.md
 * rule 8 — a column added to `RunStep` later must be added here deliberately rather than leaking
 * into an API response by default — but declared once here and inferred, not restated as a
 * hand-written interface that could drift from the query beside it. Exported so
 * `src/lib/services/consoleReads.ts`'s nested `select` reuses the same field list rather than
 * restating it a third time.
 */
export const RUN_STEP_FIELDS = {
  id: true,
  index: true,
  type: true,
  toolName: true,
  input: true,
  output: true,
  error: true,
  durationMs: true,
  tokens: true,
  createdAt: true,
} as const satisfies Prisma.RunStepSelect;

export type RunStepRecord = Prisma.RunStepGetPayload<{ select: typeof RUN_STEP_FIELDS }>;

export async function listRunSteps(
  runId: string,
  client: PrismaClient = db,
): Promise<RunStepRecord[]> {
  return client.runStep.findMany({
    where: { runId },
    orderBy: { index: 'asc' },
    select: RUN_STEP_FIELDS,
  });
}

import { Prisma, type PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import type { AssessmentDisposition } from '@/lib/domain/enums';

/**
 * The one write `save_case` is allowed to make. See
 * openspec/changes/add-agent-tools/design.md on why a second save for the same run is caught by
 * relying on `Assessment.runId`'s existing `@@unique` constraint (a P2002 from the attempted
 * `create`) rather than a `findUnique` check first — a check-then-act race with no benefit here.
 */

export type OpenCaseResult =
  { ok: true; data: { id: string } } | { ok: false; reason: 'MESSAGE_NOT_FOUND' };

/**
 * The seed creates inbound messages but no cases — a case is opened when somebody decides to work
 * a message, which is an operator action, not a fact about the mailbox. Idempotent by way of
 * `Case.inboundMessageId`'s unique index, so opening the same message twice returns the case that
 * already exists rather than failing or creating a second one.
 *
 * A discriminated result rather than a throw for the not-found case: it is the caller's (an HTTP
 * handler's) job to decide what a missing message means to its client, not this function's, and
 * every other expected outcome in this module is already this shape.
 */
export async function openCaseForMessage(
  inboundMessageId: string,
  client: PrismaClient = db,
): Promise<OpenCaseResult> {
  try {
    // `upsert` with an empty `update`, not read-then-create: the uniqueness that makes this
    // idempotent is the database's, so it is the database that should enforce it in one statement
    // — the same reasoning the header above gives for `saveAssessment`. A read-then-create would
    // also need a second read to recover from losing the race it opens.
    const result = await client.case.upsert({
      where: { inboundMessageId },
      update: {},
      create: { inboundMessageId },
      select: { id: true },
    });
    return { ok: true, data: result };
  } catch (error) {
    // P2003: the foreign key has nothing to point at, i.e. there is no such inbound message.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return { ok: false, reason: 'MESSAGE_NOT_FOUND' };
    }
    throw error;
  }
}

export interface CaseForRun {
  id: string;
  inboundMessage: {
    fromName: string;
    fromAddress: string;
    subject: string;
    body: string;
  };
}

/** The case and the message the agent is about to read. Returns null for an unknown case id. */
export async function getCaseForRun(
  caseId: string,
  client: PrismaClient = db,
): Promise<CaseForRun | null> {
  return client.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      inboundMessage: {
        select: { fromName: true, fromAddress: true, subject: true, body: true },
      },
    },
  });
}

export interface SaveAssessmentInput {
  runId: string;
  disposition: AssessmentDisposition;
  summary: string;
  structured: string; // JSON string; shape owned by the caller's Zod schema
  refusalReason?: string;
  quoteCents?: number;
  draftReply?: string;
}

export type SaveAssessmentResult =
  | { ok: true; data: { assessmentId: string } }
  | { ok: false; reason: 'RUN_NOT_FOUND' }
  | { ok: false; reason: 'ALREADY_SAVED' };

export async function saveAssessment(
  input: SaveAssessmentInput,
  client: PrismaClient = db,
): Promise<SaveAssessmentResult> {
  // A refused case carries no quote, and a non-refused case carries no refusal reason — enforced
  // here, not merely by caller discipline, since this is the one place either can be written down.
  const isQuoted = input.disposition === 'QUOTED';
  const isRefused = input.disposition === 'REFUSED';

  try {
    const assessment = await client.assessment.create({
      data: {
        runId: input.runId,
        disposition: input.disposition,
        summary: input.summary,
        structured: input.structured,
        refusalReason: isRefused ? (input.refusalReason ?? null) : null,
        quoteCents: isQuoted ? (input.quoteCents ?? null) : null,
        draftReply: input.draftReply ?? null,
      },
      select: { id: true },
    });
    return { ok: true, data: { assessmentId: assessment.id } };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return { ok: false, reason: 'ALREADY_SAVED' };
      if (error.code === 'P2003') return { ok: false, reason: 'RUN_NOT_FOUND' };
    }
    throw error;
  }
}

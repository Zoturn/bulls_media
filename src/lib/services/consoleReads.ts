import { Prisma, type PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import { RUN_STEP_FIELDS } from './runs';

/**
 * The two composite reads the console's pages need. Each is one query — Prisma's nested `select`
 * resolves the relations in a single round trip rather than N+1 — with every field named
 * explicitly per .claude/rules/data-model.md rule 8.
 *
 * Both return the Prisma shape as-is, dates included: converting to the wire format (ISO strings)
 * is `src/lib/validation/console.ts`'s job, so this module has exactly one concern — what to read
 * — and that module has exactly one concern — what a client is allowed to see.
 */

const INBOX_ROW_SELECT = {
  id: true,
  fromName: true,
  fromAddress: true,
  subject: true,
  receivedAt: true,
  case: {
    select: {
      id: true,
      status: true,
      // At most one RUNNING run can exist per case (findActiveRunForCase is what enforces that),
      // so the most recent run by start time is always the one worth showing in a list this size.
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { status: true },
      },
    },
  },
} as const satisfies Prisma.InboundMessageSelect;

export type InboxRow = Prisma.InboundMessageGetPayload<{ select: typeof INBOX_ROW_SELECT }>;

export async function listInboxRows(client: PrismaClient = db): Promise<InboxRow[]> {
  return client.inboundMessage.findMany({
    orderBy: { receivedAt: 'desc' },
    select: INBOX_ROW_SELECT,
  });
}

const CASE_DETAIL_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  inboundMessage: {
    select: {
      id: true,
      fromName: true,
      fromAddress: true,
      subject: true,
      body: true,
      receivedAt: true,
    },
  },
  runs: {
    orderBy: { startedAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      modelId: true,
      promptVersion: true,
      maxSteps: true,
      startedAt: true,
      finishedAt: true,
      totalTokens: true,
      errorMessage: true,
      steps: { orderBy: { index: 'asc' }, select: RUN_STEP_FIELDS },
      assessment: {
        select: {
          id: true,
          disposition: true,
          summary: true,
          structured: true,
          refusalReason: true,
          quoteCents: true,
          draftReply: true,
          createdAt: true,
        },
      },
      approval: {
        select: { id: true, decision: true, decidedBy: true, decidedAt: true, note: true },
      },
    },
  },
} as const satisfies Prisma.CaseSelect;

export type CaseDetailRow = Prisma.CaseGetPayload<{ select: typeof CASE_DETAIL_SELECT }>;

/** The case, its message and its most recent run in full. Null for an unknown case id. */
export async function getCaseDetailRow(
  caseId: string,
  client: PrismaClient = db,
): Promise<CaseDetailRow | null> {
  return client.case.findUnique({ where: { id: caseId }, select: CASE_DETAIL_SELECT });
}

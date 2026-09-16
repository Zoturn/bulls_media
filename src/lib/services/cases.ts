import { Prisma, type PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import type { AssessmentDisposition } from '@/lib/domain/enums';

/**
 * The one write `save_case` is allowed to make. See
 * openspec/changes/add-agent-tools/design.md on why a second save for the same run is caught by
 * relying on `Assessment.runId`'s existing `@@unique` constraint (a P2002 from the attempted
 * `create`) rather than a `findUnique` check first — a check-then-act race with no benefit here.
 */

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

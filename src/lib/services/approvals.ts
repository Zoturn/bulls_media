import { Prisma, type PrismaClient } from '@prisma/client';
import { db } from '@/lib/db';
import type { ApprovalDecision } from '@/lib/domain/enums';

/**
 * The one write this change adds beyond the agent's own: a human recording what happens to a
 * drafted reply or a flagged review. See openspec/changes/add-operator-console/design.md on why
 * one action covers both — the write does not need to know which it is deciding.
 */

export interface RecordApprovalInput {
  runId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  note?: string;
}

export type RecordApprovalResult =
  | { ok: true; data: { approvalId: string } }
  | { ok: false; reason: 'RUN_NOT_FOUND' }
  | { ok: false; reason: 'NO_ASSESSMENT' }
  | { ok: false; reason: 'ALREADY_DECIDED' };

/**
 * Creates the `Approval` and resolves the run's case in one transaction — an approval that is
 * recorded but whose case never leaves the inbox would be a decision nobody can find evidence of
 * having taken effect.
 */
export async function recordApproval(
  input: RecordApprovalInput,
  client: PrismaClient = db,
): Promise<RecordApprovalResult> {
  const run = await client.run.findUnique({
    where: { id: input.runId },
    select: { caseId: true, assessment: { select: { id: true } } },
  });
  if (run === null) return { ok: false, reason: 'RUN_NOT_FOUND' };
  if (run.assessment === null) return { ok: false, reason: 'NO_ASSESSMENT' };

  try {
    const [approval] = await client.$transaction([
      client.approval.create({
        data: {
          runId: input.runId,
          decision: input.decision,
          decidedBy: input.decidedBy,
          decidedAt: new Date(),
          note: input.note ?? null,
        },
        select: { id: true },
      }),
      client.case.update({ where: { id: run.caseId }, data: { status: 'RESOLVED' } }),
    ]);
    return { ok: true, data: { approvalId: approval.id } };
  } catch (error) {
    // P2002: `Approval.runId` is unique — a decision already exists. Caught rather than checked
    // first, the same reasoning `saveAssessment` gives for its own unique constraint: a
    // check-then-act race here has no benefit the database's own constraint doesn't already give.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'ALREADY_DECIDED' };
    }
    throw error;
  }
}

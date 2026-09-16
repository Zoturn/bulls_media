import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/http/errors';
import { logger } from '@/lib/observability/logger';
import { recordApproval } from '@/lib/services/approvals';
import { approvalRequestSchema, approvalResponseSchema } from '@/lib/validation/console';

/**
 * Records an operator's decision on a run's assessment — approving a drafted reply or a flagged
 * review, rejecting either. Exactly once per run: see
 * openspec/changes/add-operator-console/design.md on why one action covers both cases.
 */
export async function POST(req: Request, ctx: RouteContext<'/api/runs/[runId]/approval'>) {
  const { runId } = await ctx.params;

  const parsed = approvalRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', z.flattenError(parsed.error).fieldErrors);
  }

  try {
    const result = await recordApproval({ runId, ...parsed.data });
    if (!result.ok) {
      switch (result.reason) {
        case 'RUN_NOT_FOUND':
          return errorResponse('NOT_FOUND');
        case 'NO_ASSESSMENT':
          return errorResponse('NO_ASSESSMENT');
        case 'ALREADY_DECIDED':
          return errorResponse('ALREADY_DECIDED');
      }
    }
    return NextResponse.json(approvalResponseSchema.parse(result.data));
  } catch (error) {
    logger.error({ err: error, runId }, 'POST /api/runs/[runId]/approval failed');
    return errorResponse('INTERNAL_ERROR');
  }
}

import { NextResponse } from 'next/server';
import { startRun } from '@/lib/agent';
import { errorResponse } from '@/lib/http/errors';
import { logger } from '@/lib/observability/logger';
import { startRunResponseSchema } from '@/lib/validation/console';

/**
 * Starts a run for a case and responds the instant it exists — never once it finishes. See
 * .claude/rules/api-and-validation.md rule 5: a multi-step workflow is not a request/response
 * shape, and `startRun`'s `onRunStarted` hook is what makes answering this early possible.
 */
export async function POST(_req: Request, ctx: RouteContext<'/api/cases/[caseId]/runs'>) {
  const { caseId } = await ctx.params;

  try {
    const result = await startRun(caseId);
    if (!result.ok) {
      switch (result.reason) {
        case 'CASE_NOT_FOUND':
          return errorResponse('NOT_FOUND');
        case 'RUN_IN_PROGRESS':
          return errorResponse('RUN_IN_PROGRESS');
        case 'MODEL_NOT_CONFIGURED':
          return errorResponse('MODEL_NOT_CONFIGURED');
      }
    }
    return NextResponse.json(startRunResponseSchema.parse({ runId: result.runId }), {
      status: 202,
    });
  } catch (error) {
    logger.error({ err: error, caseId }, 'POST /api/cases/[caseId]/runs failed');
    return errorResponse('INTERNAL_ERROR');
  }
}

import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/http/errors';
import { logger } from '@/lib/observability/logger';
import { getCaseDetailRow } from '@/lib/services/consoleReads';
import { toCaseDetail } from '@/lib/validation/console';

/**
 * The case, its message and its most recent run — steps, assessment and approval included. This
 * is what the console polls while a run is `RUNNING`; see
 * openspec/changes/add-operator-console/design.md on why there is no separate run endpoint.
 */
export async function GET(_req: Request, ctx: RouteContext<'/api/cases/[caseId]'>) {
  const { caseId } = await ctx.params;

  try {
    const row = await getCaseDetailRow(caseId);
    if (row === null) return errorResponse('NOT_FOUND');
    // `toCaseDetail` already parses its own output — the same discipline every tool in
    // src/lib/tools/** applies — so there is nothing left to validate here.
    return NextResponse.json(toCaseDetail(row));
  } catch (error) {
    logger.error({ err: error, caseId }, 'GET /api/cases/[caseId] failed');
    return errorResponse('INTERNAL_ERROR');
  }
}

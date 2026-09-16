import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/http/errors';
import { logger } from '@/lib/observability/logger';
import { openCaseForMessage } from '@/lib/services/cases';
import { openCaseRequestSchema, openCaseResponseSchema } from '@/lib/validation/console';

/**
 * Opens (or returns the existing) case for an inbound message. Idempotent by construction —
 * `openCaseForMessage` upserts on `Case.inboundMessageId`'s unique index — so the console can call
 * this on every "view" click without tracking whether a case already exists.
 */
export async function POST(req: Request) {
  const parsed = openCaseRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', z.flattenError(parsed.error).fieldErrors);
  }

  try {
    const result = await openCaseForMessage(parsed.data.inboundMessageId);
    if (!result.ok) return errorResponse('NOT_FOUND');
    return NextResponse.json(openCaseResponseSchema.parse({ caseId: result.data.id }));
  } catch (error) {
    logger.error({ err: error }, 'POST /api/cases failed');
    return errorResponse('INTERNAL_ERROR');
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { errorResponse } from '@/lib/http/errors';
import { logger } from '@/lib/observability/logger';

/**
 * Reports whether the database is reachable. See .claude/rules/api-and-validation.md — the driver
 * error is logged, never returned, so a caller sees a stable envelope rather than a connection
 * string or a stack trace.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'reachable' });
  } catch (error) {
    logger.error({ err: error }, 'health check: database unreachable');
    return errorResponse('DATABASE_UNAVAILABLE');
  }
}

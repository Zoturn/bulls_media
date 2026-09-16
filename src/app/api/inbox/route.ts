import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/http/errors';
import { logger } from '@/lib/observability/logger';
import { listInboxRows } from '@/lib/services/consoleReads';
import { toInboxEntry } from '@/lib/validation/console';

/** Every inbound message, newest first, with its case and latest run status if any exist. */
export async function GET() {
  try {
    const rows = await listInboxRows();
    // Each entry is already parsed by `toInboxEntry` before it comes back.
    return NextResponse.json(rows.map(toInboxEntry));
  } catch (error) {
    logger.error({ err: error }, 'GET /api/inbox failed');
    return errorResponse('INTERNAL_ERROR');
  }
}

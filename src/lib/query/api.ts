import type { ApprovalDecision } from '@/lib/domain/enums';
import type { ErrorCode, ErrorEnvelope } from '@/lib/http/errors';
import {
  approvalResponseSchema,
  caseDetailSchema,
  inboxResponseSchema,
  openCaseResponseSchema,
  startRunResponseSchema,
  type CaseDetail,
  type InboxEntry,
} from '@/lib/validation/console';

/**
 * The client-side half of the shared contract in `src/lib/validation/console.ts`: every response
 * is parsed through the same schema the server built it from, per .claude/rules/typescript.md
 * rule 4 — a `fetch` response is a real boundary, not just an import.
 */

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(code: ErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

async function parseErrorEnvelope(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const envelope = body as Partial<ErrorEnvelope> | null;
  if (envelope?.error?.code !== undefined) {
    return new ApiError(envelope.error.code, envelope.error.message, envelope.error.fieldErrors);
  }
  return new ApiError('INTERNAL_ERROR', `Request failed with status ${res.status}`);
}

/** The message a component shows for a failed mutation: the server's own wording when there is one. */
export function errorMessageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export async function fetchInbox(): Promise<InboxEntry[]> {
  const res = await fetch('/api/inbox');
  if (!res.ok) throw await parseErrorEnvelope(res);
  return inboxResponseSchema.parse(await res.json());
}

export async function openCase(inboundMessageId: string): Promise<{ caseId: string }> {
  const res = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inboundMessageId }),
  });
  if (!res.ok) throw await parseErrorEnvelope(res);
  return openCaseResponseSchema.parse(await res.json());
}

export async function fetchCaseDetail(caseId: string): Promise<CaseDetail> {
  const res = await fetch(`/api/cases/${caseId}`);
  if (!res.ok) throw await parseErrorEnvelope(res);
  return caseDetailSchema.parse(await res.json());
}

export async function startRun(caseId: string): Promise<{ runId: string }> {
  const res = await fetch(`/api/cases/${caseId}/runs`, { method: 'POST' });
  if (!res.ok) throw await parseErrorEnvelope(res);
  return startRunResponseSchema.parse(await res.json());
}

export interface SubmitApprovalInput {
  decision: ApprovalDecision;
  decidedBy: string;
  note?: string;
}

export async function submitApproval(
  runId: string,
  input: SubmitApprovalInput,
): Promise<{ approvalId: string }> {
  const res = await fetch(`/api/runs/${runId}/approval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseErrorEnvelope(res);
  return approvalResponseSchema.parse(await res.json());
}

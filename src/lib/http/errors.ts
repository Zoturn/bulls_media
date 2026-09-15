import { NextResponse } from 'next/server';

/**
 * One error envelope for every endpoint: `{ error: { code, message, fieldErrors? } }`. A caller —
 * a test, the console — branches on `code`, never on `message` wording. See
 * .claude/rules/api-and-validation.md.
 *
 * `ErrorCode` is a closed union rather than `string` so a handler cannot invent a code that no
 * client is prepared to handle. Enforced at compile time is sufficient here — every `ErrorCode`
 * value is authored by a developer at the call site, never parsed from untrusted input.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'RUN_IN_PROGRESS',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]>;
  };
}

// One row per code, rather than two parallel maps that must be kept in sync by hand.
const ERROR_INFO: Record<ErrorCode, { message: string; status: number }> = {
  VALIDATION_ERROR: { message: 'The request did not pass validation.', status: 400 },
  NOT_FOUND: { message: 'The requested resource was not found.', status: 404 },
  RUN_IN_PROGRESS: { message: 'A run is already in progress for this case.', status: 409 },
  DATABASE_UNAVAILABLE: { message: 'The database could not be reached.', status: 503 },
  INTERNAL_ERROR: { message: 'An unexpected error occurred.', status: 500 },
};

/**
 * Builds the shared envelope and returns it as a `NextResponse` with the status the code implies.
 * A caller's own exception message is never passed through here — only a fixed, code-appropriate
 * message and an optional field-level breakdown from validation.
 */
export function errorResponse(
  code: ErrorCode,
  fieldErrors?: Record<string, string[]>,
): NextResponse<ErrorEnvelope> {
  const { message, status } = ERROR_INFO[code];
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    },
    { status },
  );
}

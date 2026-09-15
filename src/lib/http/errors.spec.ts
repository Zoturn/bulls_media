import { errorResponse } from './errors';

describe('errorResponse', () => {
  it('produces the envelope with the status and code for VALIDATION_ERROR', async () => {
    const res = errorResponse('VALIDATION_ERROR');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toEqual(expect.any(String));
  });

  it('produces the envelope with the status and code for NOT_FOUND', async () => {
    const res = errorResponse('NOT_FOUND');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('produces the envelope with the status and code for RUN_IN_PROGRESS', async () => {
    const res = errorResponse('RUN_IN_PROGRESS');
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('RUN_IN_PROGRESS');
  });

  it('produces the envelope with the status and code for DATABASE_UNAVAILABLE', async () => {
    const res = errorResponse('DATABASE_UNAVAILABLE');
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe('DATABASE_UNAVAILABLE');
  });

  it('includes fieldErrors when provided', async () => {
    const res = errorResponse('VALIDATION_ERROR', { budget: ['must be a positive number'] });
    const body = await res.json();

    expect(body.error.fieldErrors).toEqual({ budget: ['must be a positive number'] });
  });

  it('omits fieldErrors when not provided', async () => {
    const res = errorResponse('NOT_FOUND');
    const body = await res.json();

    expect(body.error.fieldErrors).toBeUndefined();
  });

  it('never includes a caller-supplied message — only the fixed one for the code', async () => {
    // errorResponse has no parameter for a custom message: this test documents that omission is
    // deliberate, not an oversight. A caught exception's own text must never reach the response.
    const res = errorResponse('INTERNAL_ERROR');
    const body = await res.json();

    expect(body.error.message).not.toMatch(/Error:|at\s+\w+\s+\(/); // no stack-trace-shaped text
  });
});

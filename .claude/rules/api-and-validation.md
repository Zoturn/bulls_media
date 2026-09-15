---
paths:
  - "src/app/api/**"
  - "src/lib/validation/**"
  - "src/lib/http/**"
---

# API and validation

**Scope:** The shape of the HTTP surface, the error envelope, and where enforcement happens. Route handlers under `src/app/api` are the only HTTP surface; anything the console can do, it does through them.

## Rules

1. Validate every request body and query parameter with `safeParse` before any work, because a handler that trusts its input has moved validation to whichever service happens to notice first.
2. Return one error envelope everywhere — `{ error: { code, message, fieldErrors? } }` — with a stable machine-readable `code`, since tests and the client should branch on the code and never on the prose.
3. Enforce rules server-side even when the console already prevents them, because the console is a convenience and the endpoint is the contract; an API client that never loaded the page must be refused identically.
4. Keep handlers thin: parse, call a service, map the result to a response. Business logic in a handler is logic that only an HTTP test can reach.
5. Never start an agent run synchronously inside a request that a browser is waiting on beyond its timeout — create the run, return its id, and let the console poll the trace. A multi-step workflow is not a request/response shape.
6. Make run creation idempotent per case and reject a second concurrent run for the same case with a specific code, because two runs racing on one case produce two contradictory assessments and no way to tell which the operator approved.
7. Return `404` rather than `403` for a resource the caller may not see, so the endpoint does not confirm that something exists to someone who should not know.
8. Await `params` in dynamic route handlers, since they are Promises in current Next and destructuring them synchronously fails at runtime rather than at compile time.
9. Give each endpoint an explicit response type derived from a Zod schema, so the console's types and the server's output come from one definition.
10. Never return a raw error message from a caught exception; map it to a code and log the detail. An unmapped message leaks internals to whoever can reach the endpoint.

## Examples

```ts
// no: unvalidated body, logic inline, raw error text returned to the caller
export async function POST(req: Request) {
  const body = await req.json();
  const run = await prisma.run.create({ data: { caseId: body.caseId } });
  return Response.json(run);
}

// yes: parsed, delegated, and answered with the shared envelope
export async function POST(req: Request) {
  const parsed = createRunSchema.safeParse(await req.json());
  if (!parsed.success) {
    return errorResponse('VALIDATION_ERROR', 400, z.flattenError(parsed.error));
  }

  const result = await startRun(parsed.data.caseId);
  if (!result.ok) {
    return errorResponse(result.code, result.code === 'RUN_IN_PROGRESS' ? 409 : 400);
  }

  return Response.json({ runId: result.runId }, { status: 202 });
}
```

```ts
// yes: params is a Promise in a dynamic handler
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
```

## Anti-patterns

- A handler that returns `{ error: 'something went wrong' }` in one place and `{ message: ... }` in another, so no client can branch reliably.
- Running the full agent workflow inside the POST that starts it, so the browser times out on a slow model and the run's result is lost.
- Trusting a field the console sends — an approval flag, a disposition — instead of deriving it server-side.
- Asserting in tests on the error message rather than the code, which breaks on a copy edit and passes through a contract change.

## Why

The agent exists and is trustworthy — the last two changes made it bounded, phase-scoped and
checkable. Nobody can see it work. There is no way to start a run, watch it happen, or approve
what it drafted, and the assignment's core promise is "the agent recommends; a human decides" —
a promise the codebase cannot keep without a place for the human to stand.

This change is that place: an inbox of inbound enquiries, a case view that starts a run and shows
its trace as it happens, and an approval gate that is the one irreversible-looking action in the
product.

## What Changes

- `src/lib/agent/startRun.ts`: `startRun(caseId, deps?)` — the one new entry point into the
  orchestrator this change needs. It rejects a case that does not exist, rejects a second run
  while one is already `RUNNING` for the case, rejects starting with no model configured, and
  otherwise begins `executeRun` and resolves as soon as the run exists — not when it finishes. See
  design.md for why `executeRun` gained a hook rather than this change re-deriving run creation.
- `src/lib/services/runs.ts`: `findActiveRunForCase`, the one query `startRun` needs to enforce
  "no two runs racing on one case" (`.claude/rules/api-and-validation.md` rule 6).
- `src/lib/services/approvals.ts`: `recordApproval` — the one write this change adds beyond the
  agent's own. Creates the `Approval` row and resolves the case in one transaction; a second
  decision on the same run is rejected, never silently overwritten.
- `src/lib/services/consoleReads.ts`: the two composite reads the console's pages need —
  `listInboxRows` and `getCaseDetailRow` — each one query, explicit `select`, no N+1.
- `src/lib/validation/console.ts`: the request and response schemas for every endpoint below, and
  the DTO builders that turn a Prisma read into the shape a schema accepts. One definition,
  imported by the route handlers that produce it and the client fetch functions that consume it.
- Five route handlers under `src/app/api/`: `GET /inbox`, `POST /cases`, `GET /cases/[caseId]`,
  `POST /cases/[caseId]/runs`, `POST /runs/[runId]/approval`. Each thin: parse, call a service,
  map the result.
- `src/app/console/`: the inbox page and the case detail page, plus the TanStack Query provider,
  query-key factory and client fetch wrappers that back them.

## Capabilities

### New Capabilities

- `operator-console`: the inbox, the case view, starting a run without blocking on it, watching a
  live trace, and the approval gate — plus the HTTP surface and error contract behind all of it.

### Modified Capabilities

None. `agent-orchestration`'s requirements are unchanged; `startRun` is a new caller of
`executeRun`; using a documented, already-optional extension point does not change what a run is
bounded by, decided by, or terminates in.

## Impact

- `ExecuteRunDeps` gains one optional field, `onRunStarted`. Every existing call site — every test
  in `add-agent-orchestrator` and `add-agent-guardrails` — passes none and is unaffected.
- No authentication, no multi-tenancy, no sending email: the console is a single shared view, and
  "who decided" is a name the operator types into the approval form, not an identity the system
  verifies. The README says this plainly; it is a stated boundary of the assignment, not an
  oversight.
- A run started from the console reaches a real model provider for the first time in this
  project's UI. Jest still cannot: every service and route-handler test here drives `startRun`
  with an injected mock model, exactly as `add-agent-orchestrator` drives `executeRun`. Cypress
  exercises the HTTP contract and the approval flow against fixtures written directly to the
  database — never against a live model — for the reasons `.claude/rules/testing.md` rule 4 states
  for the whole suite: a test that only passes because a key happened to be present is not a test
  of this codebase.

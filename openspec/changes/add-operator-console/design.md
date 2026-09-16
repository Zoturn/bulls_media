## Context

Every prior change proved something about the agent in isolation, against a mock model, with no
HTTP surface at all. This change is the first one a person actually uses. Two things follow from
that which did not matter before: a request cannot block on a model call (rule 5), and every read
this UI shows has to survive a run that is still in progress, because "watch it happen" is the
whole point of a live trace.

## Decisions

### `executeRun` gains one optional hook rather than this change re-deriving run creation

**Chosen:** `ExecuteRunDeps.onRunStarted?: (runId: string) => void`, called once, synchronously,
right after `createRun` resolves and before the model is ever called. `startRun` wraps the call in
a `Promise` that resolves from this hook, so the caller gets the id the instant a `Run` row exists
and never waits for `generateText`.

**Alternatives considered:** pre-creating the `Run` row in `startRun` itself and passing an
existing id into `executeRun`. Rejected: `executeRun` already owns run creation — recording the
model id, prompt version and step budget at the moment `createRun` is called — and splitting that
across two functions means either duplicating the fields it records or threading them back out
through a second API. A one-line hook is smaller than either, and it changes nothing about what a
run is bounded by, decided by, or terminates in — which is why this change carries no delta
against `agent-orchestration`'s spec.

**Deterministic check:** `startRun`'s own tests assert its returned promise resolves with a
`runId` while the scripted model's _later_ steps have not yet run — provable because the mock
model's step count at the moment of resolution is asserted directly, not inferred from timing.

### Case status changes only on a recorded decision

**Chosen:** `Case.status` starts `OPEN` and becomes `RESOLVED` only when `recordApproval`
succeeds. A refused run, a run with no brief, or a failed run leaves the case `OPEN` — its
_run's_ status is what tells the inbox there is nothing left to do, not a second bookkeeping flag.

**Alternatives considered:** auto-resolving a case whenever its run reaches a terminal status that
carries no draft reply to approve (`REFUSED`, `NOT_A_BRIEF`, `FAILED`). Rejected for this change:
it adds a second place "is this case done" is decided — the run's own status, and now a derived
rule about which statuses count — for a distinction the inbox can already show by surfacing the
run's status directly. `Case.status` staying mostly `OPEN` until an explicit human decision is a
narrower claim, and narrower is what a first console should ship. A later change can add an
explicit dismissal action if an operator needs one; this design does not preclude it.

### One approval action, its meaning read from the assessment it decides

**Chosen:** a single `POST /runs/[runId]/approval` accepting `{ decision, decidedBy, note? }`,
shown by the console whenever a run's assessment carries something to act on — a draft reply
(`QUOTED`, `NEEDS_INFO`) or a review flag (`NEEDS_REVIEW`). The endpoint itself does not
distinguish these; it records a decision against a run that has an assessment and none yet.

**Alternatives considered:** a separate "review" action for `NEEDS_HUMAN` distinct from "approve
reply" for a drafted one. Rejected: both are the same fact — a human looked at this and decided —
and splitting them would mean two endpoints, two schemas and two code paths converging on the same
`Approval` row for no behavioural difference. The console's copy changes depending on what there
is to decide; the write does not need to.

**Deterministic check:** `recordApproval`'s tests cover a run with a draft reply, a run with only
a review reason, and a run with neither (rejected — see next decision) as three cases of one
function, not three functions.

### An approval requires an assessment to decide

**Chosen:** `recordApproval` checks that the run has a saved `Assessment` before writing an
`Approval`, rejecting with `NO_ASSESSMENT` otherwise. A run with no assessment — still running,
or one that failed before saving — has nothing for a human to approve.

**Deterministic check:** a test records an approval attempt against a run with no `Assessment`
row and asserts `{ ok: false, reason: 'NO_ASSESSMENT' }`, with no `Approval` row created.

### Response shapes are schemas, parsed on the way out and on the way in

**Chosen:** every DTO this capability returns — an inbox row, a case detail, a run summary — is a
Zod schema in `src/lib/validation/console.ts`, and the read services parse their own constructed
object against it before returning, the same discipline every tool in this codebase already
applies to its own output. The client's fetch wrapper parses the same schema against the response
it receives.

**Alternatives considered:** hand-written TypeScript interfaces shared by import, with no runtime
parse. Rejected: a shared interface catches drift between the client and server at compile time
only, which is exactly the boundary `.claude/rules/typescript.md` rule 4 says to parse rather than
trust — the client is receiving JSON over `fetch`, a real boundary, not just importing a type.

**Deterministic check:** a DTO builder's own unit test constructs a Prisma read result with every
optional field both present and absent and asserts the builder's output parses.

### Every step is polled through the case, not a second endpoint

**Chosen:** there is no `GET /runs/[runId]`. The console polls `GET /cases/[caseId]`, which
already carries the latest run and its steps, and the query's `refetchInterval` reads the latest
run's status from the query's own cached data to decide whether to keep polling.

**Alternatives considered:** a dedicated run-detail endpoint, polled once a run has started.
Rejected: a case is meant to have at most one `RUNNING` run at a time (`findActiveRunForCase` is
what checks that, at the head of `startRun` — see the next risk for what "checks" stops short of),
so "the latest run" and "the run in progress" are the same row in the intended case, and a second
endpoint would exist only to return a subset of what the first already has.

## Risks

- **`startRun`'s concurrency check is check-then-act, not atomic.** `findActiveRunForCase` and the
  eventual `createRun` are two separate queries with an `await` gap between them (the model lookup
  and `getCaseForRun`'s own read), not one transaction — unlike `saveAssessment`'s and
  `recordApproval`'s own idempotency, which lean on a real unique constraint. Two `POST
/api/cases/[caseId]/runs` requests for the same case landing in that gap (a double-click before
  the button disables, or two tabs) could both pass the check and both create a `RUNNING` row. No
  unique index on `Run` enforces "at most one `RUNNING` row per `caseId`" at the database level
  today. Acceptable for a first console with one operator at a time; a real fix needs either that
  index (SQLite supports a partial unique index; Prisma's schema DSL does not express one without
  a hand-written migration) or moving the check inside `createRun`'s own transaction.
- **No authentication.** `decidedBy` is a name the operator types, not an identity the system
  checks — stated in the proposal and repeated in the README, not something this design tries to
  paper over with a plausible-looking auth stub.
- **One run's history per case, in the UI.** The data model keeps every run a case has ever had;
  the console shows only the latest. An operator retrying a failed run cannot see the earlier
  attempt without querying the database directly. Acceptable for a first console; worth naming so
  it is a decision and not an oversight.
- **The trace's `TERMINAL` step is read as loosely-typed JSON.** It is a diagnostic payload
  `add-agent-guardrails` writes for a person, not a contract this change is the first to formalise
  — `terminalStepDataSchema` in `src/lib/validation/console.ts` parses the fields the console
  renders and leaves the rest alone, so a future field on that payload does not break the console,
  but the console also cannot promise every field on it forever.

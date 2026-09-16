## 1. Orchestrator hook and the services this change needs

- [x] 1.1 `src/lib/agent/run.ts`: add `onRunStarted?: (runId: string) => void` to `ExecuteRunDeps`, invoked once, synchronously, right after `createRun` resolves
- [x] 1.2 `src/lib/agent/startRun.ts`: `startRun(caseId, deps?: { model?: LanguageModel; client?: PrismaClient })` — checks the case exists, checks no `RUNNING` run exists via `findActiveRunForCase`, checks a model is configured (default model from `anthropic(config.AGENT_MODEL)` when `deps.model` is not supplied), then calls `executeRun` and resolves as soon as `onRunStarted` fires; rejects if `executeRun` rejects before that
- [x] 1.3 Re-export `startRun` and its result type from `src/lib/agent/index.ts`
- [x] 1.4 `src/lib/services/runs.ts`: `findActiveRunForCase(caseId, client?)` — the one `RUNNING` run for a case, or null, explicit `select`
- [x] 1.5 `src/lib/services/approvals.ts`: `recordApproval({ runId, decision, decidedBy, note? }, client?)` — rejects `RUN_NOT_FOUND` (no such run), `NO_ASSESSMENT` (run has no saved assessment), `ALREADY_DECIDED` (an `Approval` already exists for this run, caught via the unique-constraint create-and-catch pattern already used in this codebase, not a check-then-act); on success, creates the `Approval` and sets the run's case to `RESOLVED` in one transaction
- [x] 1.6 `src/lib/services/consoleReads.ts`: `listInboxRows(client?)` and `getCaseDetailRow(caseId, client?)` — the two composite reads, one query each, explicit `select` down to every field the console renders, dates left as `Date` (the DTO layer converts them)
- [x] 1.7 Jest — `findActiveRunForCase`, `recordApproval` (every rejection reason, the transaction actually resolving the case, a second decision leaving the first untouched), `listInboxRows` and `getCaseDetailRow` against a seeded test database covering: no case, a case with no run, a case with a `RUNNING` run and partial steps, a case with a terminal run and an assessment, a case with an approval
- [x] 1.8 Jest — `startRun`: resolves with a `runId` while the scripted model has completed no more than its first step; rejects `CASE_NOT_FOUND`, `RUN_IN_PROGRESS` (fabricate a `RUNNING` run first), `MODEL_NOT_CONFIGURED` (no `deps.model` and no `ANTHROPIC_API_KEY`); the run it starts still reaches a terminal status and can be read back afterward

## 2. Response and request schemas

- [x] 2.1 `src/lib/validation/console.ts`: `inboxEntrySchema`, `runStepDtoSchema`, `assessmentRecordSchema`, `approvalRecordSchema`, `terminalStepDataSchema`, `runSummarySchema`, `caseDetailSchema` — Zod, `z.infer` for every exported type, no parallel interfaces
- [x] 2.2 `openCaseRequestSchema`, `approvalRequestSchema` — the two request bodies this capability accepts
- [x] 2.3 `toInboxEntry(row)` and `toCaseDetail(row)` — build the DTO from a `consoleReads` row (converting every `Date` to an ISO string) and `.parse()` it before returning, matching how every tool in `src/lib/tools/**` validates its own output
- [x] 2.4 Jest — each builder against a row with every optional field present, and again with each absent, asserting the result parses and asserting the specific fields a null case renders as (no case, no run, no assessment, no approval)

## 3. Route handlers

- [x] 3.1 `GET /api/inbox`: `listInboxRows` → `toInboxEntry` → `NextResponse.json`
- [x] 3.2 `POST /api/cases`: `safeParse(openCaseRequestSchema)` → `openCaseForMessage` → `{ caseId }`; `NOT_FOUND` when the message id does not exist
- [x] 3.3 `GET /api/cases/[caseId]`: `getCaseDetailRow` → `NOT_FOUND` when null → `toCaseDetail`
- [x] 3.4 `POST /api/cases/[caseId]/runs`: `startRun` → map `CASE_NOT_FOUND`/`RUN_IN_PROGRESS`/`MODEL_NOT_CONFIGURED` to their codes → `202 { runId }` on success
- [x] 3.5 `POST /api/runs/[runId]/approval`: `safeParse(approvalRequestSchema)` → `recordApproval` → map `RUN_NOT_FOUND`/`NO_ASSESSMENT`/`ALREADY_DECIDED` → `{ approvalId }`
- [x] 3.6 `src/lib/http/errors.ts`: add `MODEL_NOT_CONFIGURED` (503), `NO_ASSESSMENT` (409), `ALREADY_DECIDED` (409) to `ERROR_CODES`/`ERROR_INFO`
- [x] 3.7 Every dynamic handler awaits `params` per `.claude/rules/api-and-validation.md` rule 8
- [x] 3.8 Cypress — `GET /api/inbox` includes a seeded message; `POST /api/cases` is idempotent across two calls; `GET /api/cases/[caseId]` 404s for an unknown id; `POST /api/cases/[caseId]/runs` 404s for an unknown case and 409s against a case with a `RUNNING` run fabricated by a new Cypress task (never against a real model call); `POST /api/runs/[runId]/approval` succeeds against a fabricated completed run, rejects a second decision, and rejects a malformed body with `VALIDATION_ERROR` and field errors
- [x] 3.9 `cypress.config.ts`: add the fixture tasks 3.8 needs — writing a `Case`, a `Run` at a given status, and optionally an `Assessment`/`Approval` directly via Prisma, the same pattern the existing `reseed` task already uses

## 4. Client data layer

- [x] 4.1 `src/lib/query/keys.ts`: `queryKeys.inbox()`, `queryKeys.case(caseId)` — typed factories, not inline arrays
- [x] 4.2 `src/lib/query/api.ts`: `fetchInbox`, `openCase`, `fetchCaseDetail`, `startRun`, `submitApproval` — each parses the response through the matching schema from `src/lib/validation/console.ts` and throws a typed `ApiError` (carrying the envelope's `code`) on a non-2xx or unparseable response
- [x] 4.3 `src/app/providers.tsx`: `'use client'`, `QueryClient` created inside a `useState` initialiser, wraps `children` in `QueryClientProvider`
- [x] 4.4 Root layout renders `<Providers>` around `{children}`

## 5. Console pages and components

- [x] 5.1 `src/app/console/page.tsx`: server component — `listInboxRows` + `toInboxEntry` for the initial render, passed to a client `InboxView`
- [x] 5.2 `src/components/console/InboxView.tsx`: `'use client'` — `useQuery(queryKeys.inbox(), fetchInbox, { initialData })`; loading/error/empty/loaded states; each row either links to its case or opens one via `useMutation(openCase)` then navigates
- [x] 5.3 `src/app/console/cases/[caseId]/page.tsx`: server component — `getCaseDetailRow` + `toCaseDetail`, `notFound()` when null, passed to a client `CaseDetailView`
- [x] 5.4 `src/components/console/CaseDetailView.tsx`: `'use client'` — `useQuery` with `initialData` and a `refetchInterval` that stops once the latest run is terminal; the message header; a start/retry-triage button driven by `useMutation(startRun)`, disabled while a run is in progress; a live trace (steps appearing as they are polled in); the assessment's summary and structured result, summary first; refusal/violation evidence when present
- [x] 5.5 `src/components/console/ApprovalPanel.tsx`: `'use client'` — shown when the latest run has an assessment and no approval yet; a `decidedBy` field, an optional note, Approve/Reject; disabled while its mutation is pending, re-enabled on failure, never shows a decision as recorded before the server confirms it; once decided, renders the decision read-only
- [x] 5.6 `src/components/console/StatusBadge.tsx`: renders a run or case status as text plus an icon, never colour alone
- [x] 5.7 Every view handles loading, empty, error and loaded explicitly (`.claude/rules/ui-and-ux-states.md` rule 2); checked at a phone-width viewport

## 6. Documentation and close out

- [x] 6.1 Record for the README: what the console does (inbox, case detail, live trace, approval), and its stated boundaries — no auth, no email sending, one run's history shown per case
- [x] 6.2 Run `npm run typecheck && npm run lint && npm test` clean
- [x] 6.3 Run `npm run db:reset && npm run e2e` clean, on a free port (see the queued task on the port-collision in `npm run e2e`)
- [x] 6.4 Run `npm run spec:validate`
- [x] 6.5 Archive the change, write the generated spec's Purpose, and act on what the docs-sync hook reports

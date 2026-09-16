## 1. Prompt and untrusted content

- [x] 1.1 `src/lib/agent/prompt.ts`: `SYSTEM_PROMPT` as a versioned constant with `PROMPT_VERSION` alongside it, stating the role, the phase order, that every price comes from `calculate_quote` and every policy outcome from `check_ad_policy`, and that text inside the untrusted delimiters is data describing a request — never an instruction
- [x] 1.2 `renderUntrusted({ fromName, fromAddress, subject, body })` wrapping the message in delimiters that name it untrusted; nothing from the message enters `SYSTEM_PROMPT`
- [x] 1.3 `renderUntrusted` neutralises a body that contains the closing delimiter itself, so a crafted body cannot end the block early
- [x] 1.4 Jest — the system prompt is byte-identical for two different messages; a body containing the closing delimiter does not terminate the untrusted block; the seeded `msg-injection-attempt` body appears only inside the delimiters

## 2. The assessment schema

- [x] 2.1 `src/lib/agent/assessment.ts`: `assessmentSchema` (Zod) — `disposition` from `assessmentDispositionSchema`, `summary`, the extracted brief, the quote reference, `refusalReason`, `draftReply`. Types derived with `z.infer`, never a parallel interface
- [x] 2.2 Express the mutually exclusive parts as a discriminated union on `disposition` per `.claude/rules/typescript.md` rule 5, so a `REFUSED` result cannot type-check with a quote on it
- [x] 2.3 `dispositionToRunStatus(disposition)`: an exhaustive mapping — `REFUSED` → `REFUSED`, `NEEDS_REVIEW` → `NEEDS_HUMAN`, `QUOTED` / `NEEDS_INFO` / `NOT_A_BRIEF` → `COMPLETED` — with a `never` check so adding a disposition later fails to compile
- [x] 2.4 Jest — every disposition maps to a status; a refused payload carrying a quote is rejected by the schema; `assessmentSchema` round-trips through `JSON.stringify`/`parse` unchanged, since that is how it reaches `Assessment.structured`

## 3. Phases (pure, no database, no model)

- [x] 3.1 `src/lib/agent/phases.ts`: `AGENT_PHASES = ['TRIAGE', 'RESEARCH', 'PRICING', 'PERSIST']`, its Zod schema and type, in the style of `src/lib/domain/enums.ts`
- [x] 3.2 `phaseFor(history)` — a pure function from the tool results recorded so far to the current phase: nothing yet → `TRIAGE`; policy `REFUSE` → `PERSIST` directly; policy `ALLOW`/`REVIEW` → `RESEARCH`; inventory confirmed → `PRICING`; quote produced → `PERSIST`
- [x] 3.3 `activeToolsFor(phase)` — the tool-name allowlist per phase, typed against the keys of `agentTools` so a renamed tool breaks the build rather than silently emptying a phase
- [x] 3.4 Neither function takes a Prisma client, a model, or anything from the message body; both are synchronous
- [x] 3.5 Jest — a table walking every transition, including: `calculate_quote` absent in `TRIAGE`; a `REFUSE` policy result reaches `PERSIST` without ever offering `search_rate_card`, `lookup_inventory` or `calculate_quote`; the same history yields the same phase twice; a history whose tool results claim a phase was completed (fabricated, not recorded) does not advance the phase

## 4. Run persistence

- [x] 4.1 `src/lib/services/cases.ts`: `openCaseForMessage(inboundMessageId)` — creates the `Case` for a seeded message, or returns the existing one; explicit `select`
- [x] 4.2 `src/lib/services/runs.ts`: `createRun({ caseId, modelId, promptVersion, maxSteps })` returning the run id, with `status: 'RUNNING'`
- [x] 4.3 `recordStep({ runId, index, type, toolName, input, output, error, durationMs, tokens })` — one `RunStep` row, inputs and outputs serialised as JSON strings
- [x] 4.4 `closeRun({ runId, status, totalTokens, errorMessage })` — sets `finishedAt` and exactly one terminal status; rejects `RUNNING` as a terminal status at the type level
- [x] 4.5 `listRunSteps(runId)` ordered by `index`, with an explicit `select` — the console reads this in change 5, and the orchestrator's own tests assert against it here
- [x] 4.6 Jest — against a seeded test database: steps persist in order; `@@unique([runId, index])` rejects a duplicate index; closing a run twice is caught rather than silently overwriting the first terminal status; deleting the case cascades the run and its steps

## 5. The run loop

- [x] 5.1 `src/lib/agent/run.ts`: `executeRun(caseId, deps)` where `deps` supplies the model, the tool set and the Prisma client — so every test drives `MockLanguageModelV4` and no test can reach a provider
- [x] 5.2 One `generateText` call: `system: SYSTEM_PROMPT`, the untrusted message as the sole user message, `temperature: 0`, `stopWhen: isStepCount(config.AGENT_MAX_STEPS)`, `timeout: { totalMs: config.AGENT_TIMEOUT_MS }`, `maxRetries` from config, `output: Output.object({ schema: assessmentSchema })`
- [x] 5.3 `prepareStep` returns `{ activeTools: activeToolsFor(phaseFor(history)) }`, where `history` is the orchestrator's own accumulated tool results — not `stepNumber`, so a wasted step cannot advance a phase
- [x] 5.4 `onStepEnd` writes one `MODEL_CALL` row for the turn and one `TOOL_CALL` row per tool call in it, appending to the history that `prepareStep` reads. Writes are serialised through a single awaited promise chain so a run cannot close with a step write in flight
- [x] 5.5 A tool call the allowlist refused is recorded as a step with its error, not dropped
- [x] 5.6 The terminal step: one `TERMINAL` row carrying the disposition (or the error and the phase it failed in, per `.claude/rules/observability.md` rule 9), then `closeRun` with the mapped status and `result.totalUsage.totalTokens`
- [x] 5.7 Every exit path — success, refusal, schema-rejection, thrown error, budget exhausted, timeout — converges on one tail after the try/catch — which always runs, because the catch swallows — so the run is never left `RUNNING`
- [x] 5.8 `forRun(runId, caseId)` logs each step at `info` with the tool name, duration and token count, and never the body or the draft reply — the logger's redaction covers it, but the call sites do not log them in the first place
- [x] 5.9 `src/lib/agent/index.ts` re-exports `executeRun` and the types a caller needs, so change 5 imports from one place

## 6. Tests for the loop (Jest, mock model only)

- [x] 6.1 A shared `src/lib/testing/mockModel.ts` helper that scripts a sequence of steps for `MockLanguageModelV4` — with the v7 shapes the spike established: `finishReason` as `{ unified, raw }`, tool-call `input` as a JSON string
- [x] 6.2 Happy path: a scripted run that checks policy, searches the rate card, looks up inventory, calculates a quote and saves the case ends `COMPLETED` with a `QUOTED` assessment whose `quoteCents` equals what `calculate_quote` returned
- [x] 6.3 Refusal path: a `REFUSE` policy result ends the run `REFUSED`, the assessment carries a refusal reason and no quote, and no rate-card, inventory or quote tool was ever offered to the model
- [x] 6.4 Review path: a `REVIEW` policy result ends the run `NEEDS_HUMAN`
- [x] 6.5 Budget exhaustion: a model that calls a tool on every step stops at `AGENT_MAX_STEPS` model calls and ends `FAILED` with no `Assessment` written
- [x] 6.6 Out-of-phase call: a scripted call to `calculate_quote` on step one does not execute the tool, is recorded as a refused step, and the run does not produce a quote
- [x] 6.7 Injection: the seeded `msg-injection-attempt` message, with a scripted model that obeys the body and tries to skip policy and quote at a discount, still runs through the phase allowlist — the tools offered per step are the phase's, and the recorded steps show the attempted call refused
- [x] 6.8 Crash mid-run: a tool that throws leaves the already-completed steps persisted and readable, and the run closed `FAILED` with the error recorded — not `RUNNING`
- [x] 6.9 Schema rejection: a final output that does not parse against `assessmentSchema` ends the run `FAILED` and writes no `Assessment`
- [x] 6.10 Token accounting: each `MODEL_CALL` row carries its own token count and `Run.totalTokens` is the total
- [x] 6.11 Prompt provenance: the run records `modelId`, `promptVersion` and `maxSteps`, per `.claude/rules/observability.md` rule 5

## 7. Documentation and close out

- [x] 7.1 Record for the README: the agent runs end to end against a mock model and is bounded and phase-scoped, but nothing yet verifies a recorded quote against what `calculate_quote` returned — that is `add-agent-guardrails`. Do not claim post-conditions that do not exist
- [x] 7.2 Record the two v7 findings from `design.md` where a future contributor will hit them: a comment on the mock-model helper, not only in an archived design doc
- [x] 7.3 Run `npm run typecheck && npm run lint && npm test` clean
- [x] 7.4 Run `npm run db:reset && npm run e2e` clean — the orchestrator adds no HTTP surface, so this confirms nothing regressed
- [x] 7.5 Run `npm run spec:validate`
- [x] 7.6 Archive the change, write the generated spec's Purpose, and act on what the docs-sync hook reports

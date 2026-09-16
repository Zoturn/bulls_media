## Context

This is the change the assignment is really grading: "agent design quality — planning, tool use,
state management, prompt hygiene". The governing question is not whether a model can call tools,
but **where the line between code and model judgment falls**. Everything below follows from one
position: code owns the sequence and the bounds; the model owns judgment within a step.

Before designing, the AI SDK v7 surface this rests on was verified with a working spike rather
than from memory — see "What the spike established", which found two things that would otherwise
have been designed wrongly.

## Decisions

### One `generateText` call with a phase-scoped `prepareStep`, not one call per phase

**Chosen:** a single `generateText` call. `prepareStep` runs before every step, computes the
current phase from the tool results recorded so far, and returns `{ activeTools }` for that phase.

**Alternatives considered:** a separate `generateText` call per phase, each with its own tool set
and sub-budget, sequenced by the orchestrator. That is arguably more explicit, but it means
re-threading prior results into each new call's messages by hand, and it splits token accounting
and the trace across several calls for no gain in control — `prepareStep` already gives per-step
control inside one conversation, which is precisely what it exists for.

**Deterministic check:** `phaseFor(recordedToolResults)` and `activeToolsFor(phase)` are pure
functions with no database and no model call, so every phase transition and every allowlist is a
table-driven unit test. The loop's behaviour is then just those functions plus the SDK.

### The phase is computed from recorded tool results, never asked of the model

**Chosen:** phase is a pure function of which tools have already returned results on this run:
no results → `TRIAGE` (only `check_ad_policy` offered); policy `ALLOW`/`REVIEW` → `RESEARCH`
(`search_rate_card`, `lookup_inventory`); inventory confirmed → `PRICING` (`calculate_quote`);
priced, or refused, or information missing → `PERSIST` (`save_case`).

**Alternatives considered:** letting the model declare its own phase (a `set_phase` tool, or a
field in each response). Rejected outright: a phase the model can assert is a bound the model can
lift, and the whole point of the allowlist is that it holds against a message trying to talk its
way forward. A policy `REFUSE` skipping straight to `PERSIST` falls out of the same function, so
pricing tools are never offered on a refused run.

**Deterministic check:** the spike proved `activeTools` filters at _two_ layers — the excluded
tool is never sent to the provider (the model is not told it exists), and a forced call to it does
not execute, surfacing as a `tool-error` part instead. Both are assertable against a mock model
that deliberately misbehaves, and both are asserted: `run.spec.ts` reads the mock's own
`doGenerateCalls` to see the allowlist as the provider saw it, rather than inferring it from what
the model happened to call.

### `save_case` is offered in every phase

**Chosen:** the phase allowlists gate the research and pricing tools; `save_case` is in all four.

**Alternatives considered:** confining it to `PERSIST`, which is tidier and was the first draft.
It is wrong, because the phase only advances on a tool result: a run that cannot find inventory
never leaves `RESEARCH`, so with `save_case` out of reach it would burn its entire step budget and
end `FAILED` rather than recording `NEEDS_INFO` and stopping. The gate worth enforcing is "nothing
is priced before policy is known", not "nothing is recorded early", and an early save is terminal
rather than corrupting — `Assessment.runId` is unique, so there is exactly one.

### The run id never enters the prompt

**Chosen:** `buildRunTools(runId)` returns the ordinary tool set with `save_case` replaced by a
variant bound to this run, whose input schema has no `runId` field.

**Alternatives considered:** telling the model the run id in a trusted preamble and asking it to
pass it back. Rejected: that is a field the model can get wrong, turning a correct assessment into
a `RUN_NOT_FOUND`, for no benefit — the orchestrator knows the id, and the model has no legitimate
reason to choose a different one. It also keeps the untrusted user message as the _only_ thing in
the conversation besides the constant system prompt.

### The trace is finer-grained than an SDK step

**Chosen:** one `MODEL_CALL` row per model turn, plus one `TOOL_CALL` row per tool call within
that turn, plus a final `TERMINAL` row carrying the disposition — matching the `type` values
`add-project-foundation` already put on `RunStep`.

**Alternatives considered:** one row per SDK step. Rejected because an SDK step bundles the model
turn and every tool call it made into a single object, while `RunStep` has one `toolName` column
and the console has to render a timeline — "the model thought, then called this tool, then that
one" is the readable unit, not "step 3 happened".

**Consequence:** step indices are the orchestrator's own counter, not the SDK's `stepNumber`.
Duration per tool comes from `performance.toolExecutionMs`; the model turn's own duration is the
step time minus the tool time it contains.

### Retries are the SDK's, not the orchestrator's

**Chosen:** leave `maxRetries` at the SDK's own default and let it retry transient provider
failures. The orchestrator adds no retry of its own around the loop, and does not restate the
default as an option — a knob whose only effect is to reproduce current behaviour is a knob to
maintain for nothing.

**Alternatives considered:** an orchestrator-level retry of a failed run. Rejected per
`.claude/rules/agent-orchestration.md` rule 11 — the failures worth retrying are transient
provider errors, which the SDK already handles at the right granularity, and the failures that
are _not_ worth retrying (a refusal, a schema rejection) are exactly the ones a loop-level retry
would repeat expensively.

### Disposition maps to run status in code, at one place

`REFUSED` → `REFUSED`; `NEEDS_REVIEW` → `NEEDS_HUMAN`; `QUOTED`/`NEEDS_INFO`/`NOT_A_BRIEF` →
`COMPLETED`; anything thrown, or a budget exhausted without a parseable result → `FAILED`. The
mapping is a single exhaustive function over the disposition enum, so adding a disposition later
fails to compile until its status is decided.

### No HTTP surface in this change

`executeRun(caseId, deps)` is a library function. `POST /api/runs`, run polling and the console
arrive together in `add-operator-console`, where there is something to consume them. This change
is therefore Jest-only, driven by `MockLanguageModelV4` — consistent with how `add-agent-tools`
shipped with no HTTP either.

## What the spike established

Two v7 behaviours would have been designed wrongly from memory, and both would have failed
quietly rather than loudly:

- **At the provider level `finishReason` is an object, not a string.**
  `{ unified: 'tool-calls', raw: 'tool_use' }`, not `'tool-calls'` — while the `StepResult` the SDK
  hands back exposes the unified string on `finishReason` and the provider's own on
  `rawFinishReason`. The two layers are easy to conflate, and a mock returning the bare string is
  accepted without complaint: the loop then ends after one step _without executing the tool it
  just called_ — the tool call is recorded, `toolResults` comes back empty, and nothing reports an
  error. Every mock-model test in this change depends on getting this right, which is why the
  finding lives in `src/lib/testing/mockModel.ts` and not only here.
- **A tool call's `input` is a JSON string**, not an object, in the provider-level result the mock
  returns; the SDK parses it before `execute` sees it.
- **The structured output is parsed inside `generateText`, not on `.output`.** A final answer that
  does not match the schema throws out of the call itself; `.output` throws only when the loop
  ended with no final answer at all — which is exactly the budget-exhaustion case. Both paths end
  the run `FAILED`, but they are distinguished in the recorded reason, because "it ran out of
  steps" and "it answered in the wrong shape" lead a reviewer somewhere different.
- **A top-level union would not survive a real provider.** Anthropic requires `"type": "object"`
  at the root of a structured-output schema, and a top-level `z.discriminatedUnion` compiles to a
  root `anyOf`. The assessment schema is therefore `{ summary, outcome }` with the union nested
  under `outcome` — the discrimination is unchanged, and the root stays an object.

Also confirmed, and relied on below: `prepareStep` is called once per step and its `activeTools`
genuinely filters what reaches the provider; `onStepEnd` receives the full `StepResult` including
`toolCalls`, `toolResults`, `usage` and `performance.stepTimeMs`; `result.totalUsage` aggregates
tokens across steps; and `Output.object({ schema })` converts a Zod schema to JSON Schema for the
provider and returns a parsed, typed `result.output`.

## Risks

- **`onStepEnd` write ordering.** Steps are persisted from a callback the SDK invokes; if it does
  not await the callback, two step writes could interleave. Mitigated by serialising the writes
  through a single promise chain the orchestrator awaits before returning, so the run cannot be
  closed while a step write is still in flight.
- **A phase that never advances.** If the model keeps calling the same in-phase tool, the phase
  function never moves and the run burns its budget. That is the step budget doing its job, and it
  ends `FAILED` rather than looping forever — but it is worth a test, not just an argument.
- **The assessment schema is wide.** It carries the extracted brief, the quote and the drafted
  reply. A model that fills it plausibly but wrongly still produces a schema-valid result; nothing
  here catches that. That is exactly what `add-agent-guardrails`'s post-conditions are for, and
  the README should not claim otherwise until they exist.
- **The saved `Assessment` and the structured answer are written by different acts.** The row
  comes from the model's `save_case` call; the run's status comes from the structured answer it
  returns afterwards. A model could disagree with itself between the two. That is not papered over
  here, because reconciling them is precisely a post-condition — comparing a recorded quote total
  against what `calculate_quote` returned is the same check — and belongs with the rest of them in
  `add-agent-guardrails` rather than half-done in two places.

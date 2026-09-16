## Why

Five tools exist and nothing calls them. This change is the agent: the bounded, phase-scoped run
loop that turns an inbound message into a recorded, structured recommendation.

It is also the change the assignment is really assessing — "multi-step workflow (not a single
prompt)", "planning, tool use, state management". The design question is therefore not "can the
model call tools" but "what does the model decide, and what does code decide". The answer taken
here: code owns the sequence, the model owns judgment within a step. Which tools exist at a given
moment is computed from what has already happened, not asked of the model — so a tool that must
not run yet is not merely discouraged, it is not offered, and would not execute if called anyway.

## What Changes

- `src/lib/agent/run.ts`: one `generateText` call, bounded by `stopWhen: isStepCount(maxSteps)`
  and a wall-clock timeout, with `prepareStep` narrowing `activeTools` to the current phase.
- `src/lib/agent/phases.ts`: a pure function from "which tools have returned results so far" to
  the current phase, and from phase to its tool allowlist. No model call, no database — a table
  a unit test can walk end to end.
- `src/lib/agent/prompt.ts`: the versioned system instruction as a constant, and
  `renderUntrusted()`, which wraps an inbound message body in delimiters labelling it as data.
  The body never enters the system prompt.
- `src/lib/agent/assessment.ts`: the Zod schema for the structured result the run produces —
  disposition, extracted brief, quote, refusal reason, drafted reply, human summary — fed to
  `Output.object` so the final answer is parsed and typed rather than scraped from prose.
- `src/lib/services/runs.ts`: create a `Run`, append `RunStep` rows as each step completes, and
  close the run with exactly one terminal status.
- `src/lib/services/cases.ts`: `openCaseForMessage(inboundMessageId)` — the seed creates inbound
  messages but no cases, and a run needs one to belong to.
- `src/lib/agent/index.ts`: `executeRun(caseId, deps)` — the whole thing, callable without HTTP.

## Capabilities

### New Capabilities

- `agent-orchestration`: how a run is bounded, which tools exist in which phase, what is recorded
  as it happens, and how a run ends.

### Modified Capabilities

None. The five tools are consumed exactly as `add-agent-tools` left them.

## Impact

- The step budget and phase allowlist are enforced, and a `REFUSE` policy decision skips the
  research and pricing phases entirely — pricing tools are never offered on a refused run. What
  is **not** in this change is the verification layer: checking a recorded quote total against
  what `calculate_quote` actually returned, and asserting a refused assessment carries no quote.
  Those post-conditions, and the injection corpus, are `add-agent-guardrails`. This change makes
  the wrong thing hard to reach; the next one makes it impossible to record.
- No HTTP surface. `POST /api/runs` and the console that polls a run arrive with
  `add-operator-console`, so everything here is exercised by Jest against a mock model.
- Running the agent against a real provider becomes possible for the first time. The Jest suite
  still never can: `jest.setup.ts` deletes the provider keys, and every orchestrator test drives
  `MockLanguageModelV4` with scripted steps.

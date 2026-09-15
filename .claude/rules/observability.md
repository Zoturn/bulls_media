---
paths:
  - "src/lib/observability/**"
  - "src/lib/services/traces.ts"
---

# Observability

**Scope:** What a run records about itself, where it goes, and what an operator must be able to reconstruct afterwards. The assignment asks for "logs/traces of tool calls and final decision summary", so this is a graded surface, not housekeeping.

## Rules

1. Make the trace a persisted entity, not log output, because the operator console has to render it and a reviewer has to read it hours later — neither can grep the server's stdout.
2. Record one row per step with its index, type, tool name, validated input, validated output, duration, token usage and error, since a step missing its input cannot be replayed and a step missing its duration cannot be diagnosed.
3. Write the step when it completes rather than at the end of the run, because the run that most needs a trace is the one that died halfway.
4. Log as structured JSON through Pino with `runId`, `caseId` and `step` on every line, so a run is one filter away rather than a reconstruction from interleaved text.
5. Record the model id, the prompt version and the step budget on the run itself, because a trace that does not say which prompt produced it cannot explain a regression after the prompt changes.
6. Record token usage per step and total on the run, since cost per case is the number that decides whether this reaches production, and it is unavailable retroactively.
7. Keep the human-readable summary alongside the structured result rather than deriving one from the other at render time — the assignment asks for both, and an operator approving a case should read exactly what was recorded.
8. Never log the message body, a draft reply or an API key above `debug`; log identifiers and decisions. Logs travel further than the data they describe.
9. Record failures as a terminal step with the error and the phase, because "the run stopped" and "the run stopped validating the quote for the third time" lead to different fixes.
10. Keep the trace schema stable and versioned with the run, so stored runs stay readable after a tool is renamed or a step type is added.

## Examples

```ts
// no: a console line nobody can query, keyed to nothing, carrying the customer's email
console.log('tool call', toolName, JSON.stringify(input));

// yes: structured, correlated, and safe to ship to an aggregator
log.info(
  { runId, caseId, step: index, tool: toolName, durationMs, tokens: usage.totalTokens },
  'tool call completed',
);
```

```ts
// yes: the step is durable before the next one starts
await recordStep({
  runId,
  index,
  type: 'TOOL_CALL',
  toolName,
  input: toolInputSchema.parse(input),
  output: toolOutputSchema.parse(output),
  durationMs,
  error: null,
});
```

## Anti-patterns

- Building the trace in memory and writing it in a `finally`, which loses it exactly when the process dies.
- A trace that records tool names but not arguments, so a wrong answer cannot be attributed to a wrong call.
- Logging the whole model response at `info`, which puts drafted commercial correspondence into the log pipeline.
- Omitting token usage because it is not needed yet, making the first cost question unanswerable without a rerun.
- Rendering the summary from the structured result in the browser, so what the operator approved is not what was stored.

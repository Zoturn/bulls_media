---
paths:
  - "src/lib/agent/**"
---

# Agent orchestration

**Scope:** The run loop — how a run is bounded, what the model is allowed to decide, how run state is held and persisted, and how a run ends. It does not define what any individual tool does; `agent-tools.md` does that, and `guardrails-and-injection.md` governs what the loop refuses.

## Rules

1. Bound every run with `stopWhen: isStepCount(AGENT_MAX_STEPS)` and a wall-clock `timeout`, because an agent that loops on a tool it keeps failing to satisfy does not hang — it bills, and it bills until someone notices.
2. Narrow `activeTools` per phase through `prepareStep` rather than handing the model the whole toolset at every step, since a tool that cannot be called in a phase cannot be misused in it, and the allowlist is far easier to test than a prompt asking nicely.
3. Never let the model perform arithmetic or decide policy: a price comes from `calculate_quote`, a policy outcome from `check_ad_policy`. The model chooses which tool to call and explains the result, because a number a model produced is a number no test can pin and no auditor can trace.
4. Take the final result through `Output.object({ schema })` with a Zod schema, not by parsing prose, so the caller receives a typed object that either conformed or failed loudly.
5. Keep run state serializable — plain JSON, no class instances or closures — since the run's value to an operator is that it can be written down, replayed and inspected after the process that produced it is gone.
6. Persist each step as it completes rather than batching at the end, because the runs worth inspecting most are the ones that crashed, and a trace written only on success is absent exactly when it is needed.
7. Hold system instructions as a versioned constant and never build them by concatenating inbound text; the message array is where untrusted content goes. A prompt assembled from attacker-controlled strings is an injection with extra steps.
8. Set `temperature: 0` for classification and extraction, because those steps have a correct answer, and sampling variance there shows up as a flaky test and an inconsistent product.
9. End every run in exactly one terminal disposition, recorded on the run — `COMPLETED`, `REFUSED`, `NEEDS_HUMAN`, `FAILED` — so no run is left in a state the console has to guess at.
10. Decide in code, not in the prompt, whether a run stops for human approval. Asking a model to remember to pause is a request; a branch on the policy decision is a guarantee.
11. Retry only transient failures — a timeout, a 429, a 5xx — with bounded attempts and backoff, and never retry a refusal or a validation rejection, because retrying a deterministic "no" only produces the same "no" more expensively.
12. Give every run an id generated before the first model call and log it on every line, since a trace you cannot correlate with the request that caused it is not observability.

## Examples

```ts
// no: unbounded loop, every tool live at every step, and the model left to do the maths
const result = await generateText({
  model,
  tools: allTools,
  prompt: `Price this brief and reply:\n${email.body}`,
});

// yes: bounded, phase-scoped, untrusted text kept in a message rather than in the instructions
const result = await generateText({
  model,
  system: SYSTEM_PROMPT_V2,
  messages: [{ role: 'user', content: renderUntrusted(email.body) }],
  tools: allTools,
  temperature: 0,
  stopWhen: isStepCount(config.maxSteps),
  timeout: { total: config.timeoutMs },
  prepareStep: ({ stepNumber }) => ({
    activeTools: activeToolsForPhase(phaseAt(stepNumber)),
  }),
  output: Output.object({ schema: briefAssessmentSchema }),
});
```

```ts
// no: the run's history exists only in memory, so a crash takes the evidence with it
steps.push(step);
await persistRun(runId, steps);

// yes: each step is durable the moment it happens
onStepEnd: async ({ toolCalls, toolResults, usage }) => {
  await recordStep({ runId, index: index++, toolCalls, toolResults, usage });
};
```

## Anti-patterns

- A single prompt that asks for classification, retrieval, pricing and a draft at once, which is a completion wearing an agent's clothes and cannot be inspected step by step.
- Letting the model decide when it has done enough, so the stopping condition is a sentence in a prompt rather than a bound in code.
- Storing the plan or the run state as a class instance, which cannot be serialised, resumed or shown to an operator.
- Retrying a refusal because the caller wanted a different answer, which turns a guardrail into a suggestion.
- Interpolating the inbound email into the system prompt "for context", which hands the sender the same authority as the operator.

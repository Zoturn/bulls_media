## Why

`add-agent-orchestrator` made the wrong thing hard to reach. This change makes it impossible to
record.

The phase gate means a refused enquiry is never offered a pricing tool. It does not mean a refused
enquiry cannot end up with a price written against it — because nothing yet compares what the model
_says_ happened against what the tools _actually returned_. Two gaps are open and both are known:

- The `Assessment` row is written by the model's own `save_case` call, while the run's status comes
  from the structured answer it returns afterwards. A model can disagree with itself between the
  two and nothing notices.
- A quote total, a vertical, a disposition — all of these reach the database as fields the model
  populated. `calculate_quote` owns the arithmetic, but nothing checks that the number the model
  wrote down is the number the tool returned.

That is the difference between an agent that behaves and an agent that can be shown to have
behaved, and it is what `.claude/rules/guardrails-and-injection.md` rules 4, 5 and 8 require.

## What Changes

- `src/lib/guardrails/postconditions.ts`: `checkPostConditions(claim, history)` — a pure function
  from a claimed assessment plus the run's recorded tool results to a list of violations. No
  database, no model. The checks: a quoted total equals what `calculate_quote` returned; a refused
  case carries no quote; the vertical assessed is the vertical `check_ad_policy` was asked about;
  a `QUOTED` disposition requires a quote result to exist at all; a disposition does not contradict
  the policy decision.
- `src/lib/guardrails/refusal.ts`: `enforcedStatusFor(history, disposition)` — a `REFUSE` from
  `check_ad_policy` makes the run `REFUSED` whatever the model went on to say, per rule 4. Refusal
  is a decision the policy engine made, not a conclusion the model reached.
- The post-conditions run at **both** boundaries where a claim becomes a record, through one
  function: inside the run-bound `save_case` tool, before the row is written, so a violating write
  is refused and the model can correct itself within its step budget; and at run close, against the
  structured answer, so the status cannot be set from a claim the tools contradict.
- `src/lib/guardrails/untrusted.ts`: the delimiter-neutralising currently private to
  `agent/prompt.ts`, lifted out and applied to retrieved content too — a rate-card row is a
  document, and rule 6 does not exempt documents we seeded ourselves.
- `prisma/seed-data.ts`: the injection corpus grows from one fixture to a set covering the distinct
  shapes — instruction in the body, instruction in the subject, instruction in a sender name, a
  forged delimiter, a claimed prior approval, a claimed policy exception.
- Violations are recorded on the run and named in operator-facing output: which check failed, and
  against which tool result (rule 10 — an unexplained refusal gets overridden by the first person
  in a hurry).

## Capabilities

### New Capabilities

- `agent-guardrails`: what the agent refuses, what it will not record, and the deterministic checks
  that prove a non-deterministic step behaved.

### Modified Capabilities

- `agent-orchestration`: a run's terminal status is no longer taken from the model's disposition
  alone — it is subject to the enforced refusal and to the post-conditions. The requirement "A run
  ends in exactly one terminal status" gains the cases where code overrides what the model claimed.

## Impact

- `save_case` gains a failure mode: `POST_CONDITION_FAILED`, carrying the violations. It is a
  result the model can read and act on, not an exception, so a model that mis-copied a total gets
  one bounded chance to correct it before the step budget ends the run.
- The two-writers divergence recorded as a risk in `add-agent-orchestrator`'s design.md is closed:
  the same check runs over the saved row and the returned answer.
- Still no HTTP surface and still no console. `add-operator-console` renders the violations this
  change produces; here they are asserted in Jest against a mock model, as before.

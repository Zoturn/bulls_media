## Context

The orchestrator's phase gate controls what the model can _reach_. This change controls what the
system will _believe_. They are different problems: the gate is about capability, and holds even
against a model actively trying to get past it; the post-conditions are about evidence, and hold
even when every tool call was legitimate and the model simply wrote the wrong number down.

The assignment grades "guardrails / refusal rules" and "prompt injecting sec". The honest claim
this change is trying to earn is narrow and checkable: **no value the model asserts is persisted
without something deterministic agreeing with it**, and **a refusal is a fact about the run, not a
conclusion the model reached**.

## Decisions

### Post-conditions are one pure function called at two boundaries

**Chosen:** `checkPostConditions(claim, history)` — a claim plus the run's recorded tool results in,
a list of violations out. No database, no model, no clock. It is called from the run-bound
`save_case` tool before the `Assessment` row is written, and again at run close against the
structured answer before the status is set.

**Alternatives considered:** checking only inside `save_case`. That is where the rule says the check
belongs ("before persisting"), but it would leave the run's _status_ — which comes from the
structured answer, a different artefact — unchecked, and that is exactly the divergence
`add-agent-orchestrator`'s design.md recorded as an open risk. Checking only at close was also
rejected: by then the row is already written, and a guardrail that runs after the write is an audit,
not a control.

**Deterministic check:** the function takes plain data and returns plain data, so the whole matrix —
every violation, every clean case, every boundary — is a table-driven unit test with no run, no
model and no database involved. The two call sites are then tested for one thing each: that they
call it, and what they do with a non-empty result.

### A violating `save_case` is a tool failure, not an exception

**Chosen:** `save_case` returns `{ ok: false, reason: 'POST_CONDITION_FAILED', violations }`, in the
same discriminated shape as its existing `RUN_NOT_FOUND` and `ALREADY_SAVED` failures.

**Alternatives considered:** throwing. Rejected per `.claude/rules/agent-tools.md` rule 7 — this is
an expected outcome, and more usefully, it is one the model can act on: it reads the violation, sees
the total `calculate_quote` actually returned, and calls again. That is a bounded self-correction,
not a retry loop, because the step budget is still the thing that ends the run. Rule 7 of the
guardrails rule ("fail closed") is satisfied by the budget: a model that keeps violating runs out of
steps and the run ends `FAILED` with the violations recorded.

**Deterministic check:** a scripted model that calls `save_case` with a wrong total, then the right
one — asserting the first call wrote nothing and the second succeeded — and a second script that
never corrects, asserting the run ends `FAILED` with no `Assessment` row.

### Refusal outranks the disposition; a contradiction still fails the run

**Chosen:** two distinct code paths, because they answer different questions.
`enforcedStatusFor(history, disposition)` implements rule 4 — a `REFUSE` on record makes the run
`REFUSED` whatever the model said. Separately, a model that claims `QUOTED` on a refused run has
produced a claim its tool results contradict, which is a post-condition violation and is recorded as
one.

So a refused-but-quoting model produces status `REFUSED` **and** a recorded violation. Those are not
in tension: the status answers "what happened to this enquiry", the violation answers "what did the
agent get wrong", and an operator needs both. Silently mapping the disposition to `REFUSED` and
saying nothing would hide a real defect behind a correct-looking outcome.

**Deterministic check:** a scripted run where policy returns `REFUSE` and the model returns
`QUOTED`, asserting status `REFUSED`, no `quoteCents` anywhere, and a violation on the run.

### The untrusted-text handling moves out of `agent/prompt.ts`

**Chosen:** `src/lib/guardrails/untrusted.ts` owns the delimiters and the neutralising;
`agent/prompt.ts` imports it, and so does the point where retrieved rate-card text is rendered.

**Alternatives considered:** leaving it where it is and doing nothing about retrieved content, on the
grounds that we seeded the rate card ourselves. Rejected because that is precisely the assumption
rule 6 names as an anti-pattern — the retrieval path exists to turn documents into model input, and
"we wrote it" is a statement about today's corpus, not about the path.

### What this change does not attempt

It does not try to detect instructions semantically. There is no classifier deciding whether a
sentence is an injection, because that is another non-deterministic step needing its own guarantee,
and the guarantees here are meant to be the ones that do not need one. The defence is structural:
the text cannot reach the system prompt, the tools cannot be reached out of phase, and the numbers
cannot be recorded without a tool result behind them.

## What this closes

`add-agent-orchestrator`'s design.md recorded an open risk: "the saved `Assessment` and the
structured answer are written by different acts … a model could disagree with itself between the
two." That archived document is left as it was — it was accurate when written, and rewriting an
archived decision record to look prescient is how a project loses the ability to explain itself.
The closure is here instead: one `checkPostConditions` runs over the `save_case` input before the
row is written and over the structured answer before the status is set, so a model that disagrees
with itself is caught at whichever boundary it reaches second.

## The precedence of a run's terminal status

The two enforcement mechanisms and the existing failure paths all set the same field, so the order
is fixed in one place in `executeRun` rather than emerging from the order the code happens to run
in:

1. **the trace could not be written → `FAILED`** — nothing about the run can be vouched for.
2. **policy refused → `REFUSED`** — rule 4, and it outranks 3 deliberately: a refused enquiry whose
   model then burned its step budget has still been refused, and closing it `FAILED` would present
   a settled policy decision as an infrastructure problem for somebody to retry. The failure is
   kept in `errorMessage` and in the terminal step alongside the refusal.
3. **anything went wrong → `FAILED`** — rule 7, fail closed.
4. **otherwise → whatever the disposition maps to.**

**Deterministic check:** `enforcedStatusFor(history, disposition)` covers 2 and 4 as a pure
function with a disposition that may be absent, so both the "refused and answered" and "refused and
never answered" cases are unit tests; 1 and 3 are asserted through `executeRun` against a scripted
model and a client whose step writes always fail.

## Risks

- **A vertical check that is too strict.** Requiring the assessed vertical to match what
  `check_ad_policy` was asked about is right, but the model chose that argument in the first place —
  so this catches "the assessment reports a different vertical from the one checked", not "the model
  classified the enquiry wrongly". The second is a real risk and this change does not address it;
  the README must not imply otherwise.
- **Comparing totals assumes one quote per run.** If a model legitimately calls `calculate_quote`
  more than once — revising after an inventory shortfall — the claim must match one of the recorded
  results, not merely the last. The check is written that way; the risk is that "any recorded
  result" is weaker than it looks if a model produces several and picks the most flattering. Pinning
  it to the most recent is stricter but breaks the legitimate revision case. The looser rule plus
  the full trace is the choice made here.
- **The corpus is illustrative, not exhaustive.** Six fixtures covering six shapes is enough to
  demonstrate the defence and to catch a regression in it. It is not a claim that the defence is
  complete, and the README should say so in those words.

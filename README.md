# Inbound Brief Desk

An AI agent that triages inbound advertising enquiries for a media sales team, and stops for a
human before anything leaves the building.

> **Status:** every planned change is built and tested end to end — the agent, the operator
> console, and the worked examples and documentation below. The table in
> [Implementation status](#implementation-status) says exactly what each change delivered.

## Problem statement

A media sales team receives inbound advertising enquiries by email. Most are variations on the same
shape — an advertiser, a budget, a flight window, a vertical, some goals — and each one currently
costs a sales-ops person fifteen to thirty minutes of the same work:

1. decide whether it is a real opportunity at all, or a vendor pitch, a support question, or spam;
2. pull the brief out of prose that is never structured the same way twice;
3. check the advertiser's category against what the business is allowed to sell — some verticals
   are refused outright, others need legal review or a disclosure;
4. find the packages that match the ask in a rate card nobody has memorised;
5. price them, applying the volume discount bands correctly;
6. write a reply that quotes accurately and does not promise inventory that is not there.

It is high volume, low variance, and carries real downside: a quote with the wrong discount band is
a margin loss, and a campaign accepted in a prohibited vertical is a compliance incident. It is also
exactly the shape of work an agent is good at — bounded, tool-heavy, and reviewable.

## What the agent does

For each inbound message, the agent runs a bounded multi-step workflow and produces a
**recommendation** — a structured assessment plus a drafted reply — which a human then approves or
rejects. The agent never sends anything.

### In scope

- Classifying an inbound message: advertising brief, or not.
- Extracting a structured brief from free-text email.
- Checking the vertical and the ask against a policy table, including outright refusal.
- Searching the rate card for packages that match the ask.
- Pricing a package with a deterministic calculator, including volume discounts.
- Drafting a reply grounded only in what the tools returned.
- Recording every step, so an operator can see what was called and why.
- Stopping for human approval before the result counts as anything.

### Explicitly not in scope

- **Sending email.** Nothing is dispatched. The drafted reply is stored for a human to copy or edit.
- **Receiving email.** Inbound messages are seeded fixtures, not a live mailbox.
- **CRM integration.** The "CRM" is a local table.
- **Authentication and multi-tenancy.** The console is single-user and unauthenticated.
- **Autonomous action of any kind.** Every outcome is a recommendation.

Those boundaries are deliberate. They are where a take-home should stop and where a production
build would start; [Next steps](#next-steps) says what each would take.

## Business cases covered

| #   | Case                                               | What the agent produces                                                                      |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | A complete brief in a permitted vertical           | A structured brief, matching packages, a priced quote and a drafted reply — pending approval |
| 2   | A brief in a prohibited vertical                   | A refusal naming the policy rule, with no quote produced at all                              |
| 3   | A brief in a vertical requiring review             | An assessment flagged for human review before any quote is offered                           |
| 4   | A message carrying instructions aimed at the agent | The instructions are treated as data; the workflow is unchanged                              |
| 5   | A message that is not an advertising brief         | An early exit with a disposition, without spending steps on extraction or pricing            |
| 6   | A brief missing what is needed to quote            | A request for the missing detail, rather than a quote built on a guess                       |

## Architecture

```
Inbound message (seeded fixture)
        |
        v
  Operator console --POST /api/runs-->  Orchestrator  -->  bounded loop, per-phase tool allowlist
  (Next.js, TanStack Query)                  |
        ^                                    |-- classify / extract   (model, temperature 0)
        |                                    |-- check_ad_policy      (deterministic, data-backed)
        |                                    |-- search_rate_card     (lexical, MiniSearch)
        |                                    |-- lookup_inventory     (deterministic)
        |                                    |-- calculate_quote      (deterministic arithmetic)
        |                                    |-- save_case            (the only write)
        |                                    |
        +--GET /api/runs/:id-----------  Run + RunStep rows  <-- each step persisted as it completes
                                             |
                                             v
                                    Guardrails: refusal enforced in code,
                                    post-conditions checked against recorded
                                    tool results, then human approval
```

**Why a custom orchestrator, not LangGraph or an agents SDK.** `ai` v7 (`@ai-sdk/anthropic`) is the
only framework dependency; the run loop itself is a typed function written here on top of its
tool-calling primitives, not a third-party graph runtime. Three reasons: agent design is what this
assignment grades, and a framework's graph hides the reasoning a reviewer wants to see; LangGraph's
checkpointer would duplicate the `Run`/`RunStep` tables this project already needs for its own
trace; and a graph runtime, a planner and a state machine are heavier than a bounded loop over five
tools warrants. The AI SDK's own `prepareStep` and `stopWhen` give the per-phase tool allowlist and
the step budget without a second one. The consequence is named honestly in
[Trade-offs and limitations](#trade-offs-and-limitations): resumability is not free this way, and
this project does not have it yet.

Four properties, named against what an agent design is actually judged on:

- **Planning.** A phase machine — `TRIAGE → RESEARCH → PRICING → PERSIST` — decides which tools
  exist at each step. The phase is computed from tool _results_ recorded so far, never from the
  model's own account of where it is or anything an inbound message asserts, so a plan cannot be
  advanced by a claim — only by evidence a tool actually produced.
- **Tool use.** Five tools — `check_ad_policy`, `search_rate_card`, `lookup_inventory`,
  `calculate_quote`, `save_case` — each a deterministic engine the model calls and reads back. The
  model never computes a price or decides a policy outcome itself: a price comes from
  `calculate_quote`, a policy decision from `check_ad_policy`. A number a model produced is a
  number no test can pin.
- **State management.** A run's state is exactly its recorded steps: plain, serializable JSON
  persisted to `Run`/`RunStep` as each one completes, never a class instance or an in-memory plan
  a crash would lose.
- **Prompt hygiene.** The inbound message is untrusted text: it is delimited, confined to a user
  message, and never reaches the system prompt, which is a fixed, versioned constant. Post-
  conditions are then checked against the recorded trace, not the model's own account — the quoted
  total must equal what `calculate_quote` returned, and a refused case must carry no quote.

Detail, and the alternatives rejected along the way, is in
[`openspec/changes/archive/2026-09-15-add-project-foundation/design.md`](openspec/changes/archive/2026-09-15-add-project-foundation/design.md).

## The operator console

`/console` lists every inbound message and whether a case has been opened for it. Opening one and
starting triage shows the run's steps as they complete, the structured assessment and drafted
reply once it finishes, and — for anything with a disposition a human should sign off on — an
approval panel that records who decided and how, then resolves the case. Nothing is sent anywhere
on approval; the decision is the only side effect.

Stated boundaries, not oversights: there is no authentication, so `decidedBy` is a name an operator
types rather than an identity the system checks; a case shows only its **latest** run even though
every run it has ever had is kept in the database; and, per the project's scope, nothing here sends
email or writes to a real CRM.

## Setup

Requires Node 22+. No Docker, no database server.

```bash
npm install
cp .env.example .env         # ANTHROPIC_API_KEY is only needed to run the agent live
npm run db:migrate
npm run db:seed
npm run dev                  # http://localhost:3000
```

SQLite is used so that the first run costs nothing but `npm install`. Moving to PostgreSQL is the
`DATABASE_URL` in `.env` and the `provider` line in `prisma/schema.prisma` — the schema uses no
engine-specific types.

`ANTHROPIC_API_KEY` is validated by `src/lib/config.ts` when present but is otherwise optional: the
console, the whole Jest suite and every other command below run with no key at all — it is only
read the moment an operator clicks **Start Triage** in the console to run the agent against a real
model.

## How to test and verify

```bash
npm run typecheck
npm run lint
npm test                          # Jest — runs offline, no API key required
npm run db:reset && npm run e2e   # Cypress against a freshly seeded database
```

All four run today, and `jest.setup.ts` deletes the provider keys before the suite runs, so no
Jest test can reach a real model even by accident — the orchestrator, guardrails and every route
handler that starts a run are driven by `MockLanguageModelV4` instead. That is what makes
assertions about agent behaviour — "this refusal happened", "this tool was never called" —
deterministic rather than anecdotal.

Cypress is the only layer that reaches a real HTTP server, and even there nothing reaches a real
model: the approval flow and every run the console UI tests need already decided are written
directly through Prisma by a Cypress task (`createFixtureRun` in `cypress.config.ts`), and
`startRun`'s own model-driven path is covered in Jest (`src/lib/agent/startRun.spec.ts`) instead.

Manually: seed the database, run `npm run dev`, open `/console`. Any seeded message demonstrates
starting a run; the "Business cases covered" table above names which message demonstrates which
case (its subject line is visible in the inbox) — click **Start Triage** (needs
`ANTHROPIC_API_KEY`) and watch the trace fill in as each tool call completes.

`npm run e2e` starts its own dev server on port 3000. Next.js 16 allows only one `next dev` per
project directory, regardless of port — if you already have one running on a different port for
this project (say, from poking around during development), `npm run e2e` fails to start its own
with `Another next dev server is already running`. Stop the other one first; a server already
running on the exact default port 3000 is reused automatically and needs no action.

`npm run examples:generate` regenerates every file under [`examples/`](#example-inputs-and-outputs)
from a fresh run of the real orchestrator against its own disposable database — not part of the
verification gate above, since nothing here asserts examples are current, but the way to confirm
they still are.

## Example inputs and outputs

One worked example per business case above, each showing the inbound message, the full step-by-
step trace and the resulting assessment — regenerated from a real run of the orchestrator against
the real deterministic tools by `npm run examples:generate`
([design.md](openspec/changes/archive/2026-09-16-add-docs-and-verification/design.md) says what
"real" means there):

| Case                                               | Example                                                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A complete brief in a permitted vertical           | [examples/01-ordinary-brief-quoted.md](examples/01-ordinary-brief-quoted.md)                               |
| A brief in a prohibited vertical                   | [examples/02-prohibited-vertical-refused.md](examples/02-prohibited-vertical-refused.md)                   |
| A brief in a vertical requiring review             | [examples/03-review-vertical-needs-review.md](examples/03-review-vertical-needs-review.md)                 |
| A message carrying instructions aimed at the agent | [examples/04-injection-attempt-unchanged-workflow.md](examples/04-injection-attempt-unchanged-workflow.md) |
| A message that is not an advertising brief         | [examples/05-not-a-brief-early-exit.md](examples/05-not-a-brief-early-exit.md)                             |
| A brief missing what is needed to quote            | [examples/06-missing-budget-needs-info.md](examples/06-missing-budget-needs-info.md)                       |

## Trade-offs and limitations

- **SQLite, not PostgreSQL.** Chosen so a reviewer can run this in one command. Weaker concurrency;
  irrelevant for a single-operator console, and the swap is two lines.
- **Lexical retrieval, not embeddings.** Deterministic and offline, so retrieval tests assert exact
  results — but it will miss a semantically similar query sharing no terms with the rate card.
- **No resumability.** Run state is persisted per step so it is possible, but a crashed run is not
  currently resumed; it is re-run.
- **Prompt injection is mitigated, not solved.** Untrusted text is delimited and kept out of the
  system prompt, refusals are enforced in code rather than by the model, and post-conditions are
  checked against recorded tool results. A determined novel attack on the model's reasoning remains
  possible; the controls are designed so that succeeding at that still does not let it change a
  policy outcome, a price, or what gets written.
- **Single-operator console.** No authentication, so nothing distinguishes two operators.

## Next steps

- Real mailbox intake and outbound send, both behind the same approval gate.
- Authentication and per-operator audit, so an approval names who made it.
- Resumable runs from persisted step state.
- pgvector retrieval once the rate-card corpus outgrows lexical search.
- OpenTelemetry export of the trace, alongside the database records.
- Cost and latency budgets per case, surfaced in the console.

## Real-world usage

**Is this solution currently used in any business? No — not in production today.** It was built as
a take-home exercise and has never processed real advertiser correspondence.

Three kinds of team could use this shape of system:

1. **A regional media owner's ad-sales desk** — radio, out-of-home, or a publisher network — where
   inbound briefs arrive by email and pricing lives in a rate card rather than a self-serve
   platform. This is the case the project is modelled on.
2. **An agency's new-business team**, triaging inbound RFPs: classify, extract, check the conflict
   and compliance rules, and route to the right practice lead with a first-pass response drafted.
3. **A B2B sales operations team** in any business with a structured price list and a compliance
   boundary — logistics quoting, insurance brokerage, regulated financial products — where the
   workflow is the same and only the tools change.

Productionising it would require, at minimum:

- **Security:** authenticated operators, per-tenant data isolation, secrets in a managed store, and
  a periodic review of the injection corpus against new attack shapes.
- **Monitoring:** cost and token budgets per case with alerting, refusal rate and
  approval-override rate as tracked metrics, and trace export to an existing observability stack.
- **Data access:** real CRM and inventory integrations, with the rate card as a system of record
  rather than a seeded table, and freshness guarantees on both.
- **Human-in-the-loop:** the approval gate kept mandatory for anything priced, with a documented
  escalation path for refusals and a way for an operator to record why they overrode one.
- **Compliance:** retention and deletion policy for inbound correspondence, a data-processing
  position on sending advertiser text to a model provider, and an auditable record of who approved
  what and when.

## Implementation status

| Change                      | Delivers                                                             | Status   |
| --------------------------- | -------------------------------------------------------------------- | -------- |
| `add-project-foundation`    | schema, migration, deterministic seed, config, logging, health check | **done** |
| `add-agent-tools`           | the five tools, their engines, retrieval index                       | **done** |
| `add-agent-orchestrator`    | run loop, phases, step budget, structured result, trace              | **done** |
| `add-agent-guardrails`      | refusal rules, injection defences, post-conditions                   | **done** |
| `add-operator-console`      | inbox, case detail, live trace, approval gate                        | **done** |
| `add-docs-and-verification` | worked examples, end-to-end suite, final README                      | **done** |

## How this was built

Every change starts as an OpenSpec proposal under `openspec/` — why, then the specification, then
the design and its rejected alternatives, then an ordered task list — and is archived before the
next begins. The conventions the code is held to are in `.claude/rules/`, and the repetitive parts
of following them are enforced by hooks in `.claude/settings.json` rather than by remembering:
formatting, a companion-test check, a guard against committing an API key, and a commit gate that
requires a review pass plus a green typecheck, lint and test run.

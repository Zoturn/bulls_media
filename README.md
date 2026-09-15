# Inbound Brief Desk

An AI agent that triages inbound advertising enquiries for a media sales team, and stops for a
human before anything leaves the building.

> **Status:** foundation in progress. The design is settled and specified under `openspec/`; the
> table in [Implementation status](#implementation-status) says exactly what is built so far. This
> README describes the system as specified, and marks anything not yet implemented.

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

Three properties do the real work:

- **The model never computes and never decides policy.** A price comes from `calculate_quote`; a
  policy outcome comes from `check_ad_policy`. The model chooses which tool to call and explains
  the result. A number a model produced is a number no test can pin.
- **The loop is bounded and phase-scoped.** A step budget caps iterations, and `prepareStep`
  narrows the available tools per phase, so a tool that must not run in a phase cannot.
- **Post-conditions are checked against the trace, not against the model's own account.** The
  quoted total must equal what the calculator returned; a refused case must carry no quote.

Detail, and the alternatives rejected along the way, is in
[`openspec/changes/add-project-foundation/design.md`](openspec/changes/add-project-foundation/design.md).

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

## How to test and verify

```bash
npm run typecheck
npm run lint
npm test                          # Jest — runs offline, no API key required
npm run db:reset && npm run e2e   # Cypress against a freshly seeded database
```

The first three run today. `npm run e2e` has no specs to run until `add-project-foundation` lands
its Cypress checks, and will report that rather than pass.

The Jest suite cannot reach a model provider: `jest.setup.ts` deletes the provider keys, and the
orchestrator is driven by `MockLanguageModelV4` with scripted tool calls. That is what makes
assertions about agent behaviour — "this refusal happened", "this tool was never called" —
deterministic rather than anecdotal.

Manual verification scenarios, with the seeded fixture each one uses, will be listed here as the
console lands.

## Example inputs and outputs

To be added once the orchestrator runs end to end: a seeded enquiry, the resulting structured
assessment, the drafted reply, and the step-by-step trace.

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

| Change                      | Delivers                                                             | Status      |
| --------------------------- | -------------------------------------------------------------------- | ----------- |
| `add-project-foundation`    | schema, migration, deterministic seed, config, logging, health check | specified   |
| `add-agent-tools`           | the five tools, their engines, retrieval index                       | not started |
| `add-agent-orchestrator`    | run loop, phases, step budget, structured result, trace              | not started |
| `add-agent-guardrails`      | refusal rules, injection defences, post-conditions                   | not started |
| `add-operator-console`      | inbox, case detail, live trace, approval gate                        | not started |
| `add-docs-and-verification` | worked examples, end-to-end suite, final README                      | not started |

## How this was built

Every change starts as an OpenSpec proposal under `openspec/` — why, then the specification, then
the design and its rejected alternatives, then an ordered task list — and is archived before the
next begins. The conventions the code is held to are in `.claude/rules/`, and the repetitive parts
of following them are enforced by hooks in `.claude/settings.json` rather than by remembering:
formatting, a companion-test check, a guard against committing an API key, and a commit gate that
requires a review pass plus a green typecheck, lint and test run.

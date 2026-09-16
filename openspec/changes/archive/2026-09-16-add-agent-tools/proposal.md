## Why

The foundation has data and nothing that reads it purposefully. This change builds the five things
the orchestrator (next change) will call: deterministic, offline, individually testable functions
that do the actual work — matching a vertical against policy, finding rate-card packages, checking
availability, pricing a package, and recording the outcome. None of them touch a model.

This is also where the project's central engineering claim gets built, not just stated: a model
that can only call these tools cannot invent a price or a policy decision, because neither exists
anywhere a model could produce it. Building the tools before the orchestrator that calls them is
deliberate — each one is fully specified and tested in isolation, so the orchestrator change can
treat them as a fixed, trusted surface rather than co-designing them under time pressure.

## What Changes

- `check_ad_policy`: looks up a vertical against the seeded `PolicyRule` table, returning
  `ALLOW` / `REVIEW` / `REFUSE` with the matching rule, and a defined fallback for an
  unrecognised vertical.
- `search_rate_card`: a MiniSearch (BM25, lexical) index over the seeded `RateCardPackage` rows —
  not a separate hand-authored document corpus, which would duplicate the same five packages in
  two places with no mechanism keeping them in agreement. Returns matching packages ranked by
  relevance to a free-text query, optionally filtered by channel.
- `lookup_inventory`: given a specific package id and a requested volume, confirms whether that
  volume is currently available. Kept distinct from `search_rate_card` — a search result is for
  browsing, not a commitment, and this is the one check a quote is allowed to rely on.
- `calculate_quote`: given one or more `{ packageId, requestedVolume }` line items, returns a
  subtotal, an applied volume discount, and a total, in cents, deterministically. No rounding
  surprises, no floating point — this is the arithmetic the model is never allowed to do itself.
- `save_case`: the one write. Persists a structured assessment (disposition, the extracted brief,
  the quote if any, the drafted reply if any, the refusal reason if any) against a run, through a
  service in `src/lib/services/`, not directly through Prisma from the tool.
- A `src/lib/tools/engines/` layer under each tool: the pure, DB-free computation (discount tiers,
  ranking, matching) that a unit test drives with fixture data, separate from the thin `execute`
  that wires a tool to real data.

## Capabilities

### New Capabilities

- `agent-tools`: what each tool accepts, what it guarantees about its own output, what counts as
  "no match" versus a refusal, and what a caller may rely on without re-checking.

### Modified Capabilities

None. `platform-foundation`'s schema and seed are read here, not changed.

## Impact

- Removes the `content/` directory from the project layout as originally sketched in `CLAUDE.md`.
  That plan predated this change's design; building the search index from `RateCardPackage` rows
  instead keeps one source of truth for the five seeded packages rather than two that could drift.
  `CLAUDE.md` and `.prettierignore` are updated to match.
- `save_case` is the first tool that writes, and the first thing in this codebase to need a `Run`
  row to attach to — one does not yet get created by anything, since that is the orchestrator's
  job (`add-agent-orchestrator`). Tests create a fixture `Run` directly, the same way
  `prisma/schema.spec.ts` already does for schema-level tests.
- No refusal is actually enforced yet. `check_ad_policy` reports a decision; nothing yet stops a
  run from proceeding past a `REFUSE`. That enforcement is `add-agent-guardrails`'s job, and is
  named here so it is not mistaken for already being covered.

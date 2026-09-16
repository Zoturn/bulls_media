## Why

Five changes have built and proven the agent and the console that runs it — but proof today lives
entirely in test output nobody outside this repo will run. A reviewer opening the README sees a
"to be added" placeholder where the worked examples should be, an "Implementation status" table
that is the only place the finished state is summarised, and no record of what a real run actually
produces for each of the six business cases the project claims to cover. The assignment is graded
by reading, not only by running `npm test`.

This change closes that gap: committed, reproducible worked examples for all six business cases,
and a README that states plainly what exists, how to verify it, and where its edges are — the
final artefact a reviewer reads before opening any code.

## What Changes

- `scripts/generate-examples.ts`: a standalone script (`npm run examples:generate`) that runs the
  real orchestrator, against the real deterministic tools, once per seeded business-case message —
  a scripted model stands in only for the parts of a real model's behaviour that cannot be pinned
  (tool selection order, prose), never for `check_ad_policy`, `search_rate_card` or
  `calculate_quote`'s own results, which are the actual seeded rate card and policy table doing
  the same work they would for a live run. Writes one Markdown file per case to `examples/`: the
  inbound message, the step-by-step trace, and the resulting assessment.
- `examples/*.md`: the six generated files, committed so a reviewer reads them without running
  anything — one per row in the README's "Business cases covered" table.
- `README.md`: replaces the "Example inputs and outputs" placeholder with links to the generated
  examples; updates "Implementation status" to mark every change done; documents the one real
  gotcha found while finishing this change — Next.js 16 allows a single `next dev` per project
  directory regardless of port, so `npm run e2e`'s own server fails to start if a different-port
  dev server for this project is already running elsewhere; and gives the manual verification walk
  a concrete list of which seeded message demonstrates which case.
- No source code in `src/` changes. This is the one change in the sequence that touches no
  application behaviour — everything it adds is either a one-off generator script or documentation
  — so there is nothing here for `agent-orchestration`, `agent-tools`, `agent-guardrails` or
  `operator-console` to gain a requirement from.

## Capabilities

### New Capabilities

- `project-verification`: what the project commits to proving about itself before a human reads
  the source — a worked example per business case, and documentation that states current status,
  how to reproduce every verification claim, and where the system's edges are, accurately enough
  that following it reproduces a clean pass.

### Modified Capabilities

None. This change adds no new application behaviour to modify a requirement of.

## Impact

- `package.json` gains one script, `examples:generate`; nothing existing changes shape.
- `examples/` is a new top-level directory of committed, generated Markdown — regenerable at any
  time by rerunning the script against the current seed, but not regenerated automatically, so a
  future change to the seed data regenerates `examples/` deliberately rather than drifting
  silently out of sync with it. `.gitignore` is unaffected — these files are meant to be tracked.

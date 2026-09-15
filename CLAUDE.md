# Inbound Brief Desk

An AI agent that triages inbound advertising enquiries for a media sales team. An advertiser
emails in; the agent classifies the message, extracts a structured brief, checks it against ad
policy, searches the rate card, prices a package and drafts a reply — then stops and waits for a
human to approve. It never sends anything on its own.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · TanStack Query ·
AI SDK v7 (`ai`) + Anthropic · Prisma · SQLite · Zod · MiniSearch · Pino · Jest · Cypress · npm

## Layout

```
src/app/console/      operator console — inbox, case detail, run trace, approval
src/app/api/          REST route handlers — the only HTTP surface
src/lib/agent/        the orchestrator: run loop, phases, step budget, run state
src/lib/tools/        the five agent tools and their deterministic engines
src/lib/guardrails/   refusal rules, untrusted-content handling, post-conditions
src/lib/services/     case, run and trace persistence
src/lib/observability/ structured logging and trace recording
prisma/               schema, migrations, deterministic seed
content/              seeded rate-card and policy corpus the retrieval tool searches
openspec/             change proposals and the specs they produce
.claude/rules/        the conventions this project is held to
.claude/hooks/        automation (see below)
```

The agent recommends; a human decides. Sending email, CRM integration, authentication and
multi-tenancy are out of scope — the README says so explicitly and the console reflects it.

## Commands

```bash
npm install
cp .env.example .env         # then set ANTHROPIC_API_KEY
npm run db:migrate
npm run db:seed              # deterministic fixtures, including the adversarial ones
npm run dev

npm run typecheck
npm run lint
npm test                     # Jest — runs offline, no API key
npm run db:reset && npm run e2e   # Cypress against a freshly seeded database
npm run spec:validate
```

## Working here

Changes start as an OpenSpec proposal, not as code. Read
[.claude/rules/openspec-workflow.md](.claude/rules/openspec-workflow.md) before starting anything.
Each change is archived before the next begins.

| Order | Change                      | Delivers                                                        |
| ----- | --------------------------- | --------------------------------------------------------------- |
| 1     | `add-project-foundation`    | schema, migration, deterministic seed, logging, health check    |
| 2     | `add-agent-tools`           | the five tools, their engines, retrieval index, unit tests      |
| 3     | `add-agent-orchestrator`    | run loop, phases, step budget, structured result, trace records |
| 4     | `add-agent-guardrails`      | refusal rules, injection defences, post-condition checks        |
| 5     | `add-operator-console`      | inbox, case detail, live trace, approval gate                   |
| 6     | `add-docs-and-verification` | README, sample inputs/outputs, end-to-end suite                 |

## Rules

| Rule                                                                     | Covers                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [openspec-workflow.md](.claude/rules/openspec-workflow.md)               | proposing, specifying, applying and archiving a change       |
| [typescript.md](.claude/rules/typescript.md)                             | strictness, no `any`, types inferred from schemas            |
| [agent-orchestration.md](.claude/rules/agent-orchestration.md)           | the run loop, step budget, phases, run state, termination    |
| [agent-tools.md](.claude/rules/agent-tools.md)                           | tool contracts, determinism, what the model may not do       |
| [guardrails-and-injection.md](.claude/rules/guardrails-and-injection.md) | untrusted text, refusal, post-conditions, the threat model   |
| [observability.md](.claude/rules/observability.md)                       | what a run records and what must be reconstructable          |
| [data-model.md](.claude/rules/data-model.md)                             | schema conventions, migrations, the deterministic seed       |
| [api-and-validation.md](.claude/rules/api-and-validation.md)             | endpoint shapes, the error envelope, server-side enforcement |
| [nextjs-and-data-fetching.md](.claude/rules/nextjs-and-data-fetching.md) | server/client boundary, TanStack Query, polling a live run   |
| [ui-and-ux-states.md](.claude/rules/ui-and-ux-states.md)                 | styling, loading, empty, error states, approval clarity      |
| [testing.md](.claude/rules/testing.md)                                   | Jest vs Cypress, the mock model, the offline requirement     |

## Automation

Repeated actions are hooks in [.claude/settings.json](.claude/settings.json), never instructions in
a rule. They run whether or not anyone remembers them, and no-op in a clone with nothing installed.

| Hook                                                   | Fires                    | Does                                                              |
| ------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------- |
| [secrets-guard.sh](.claude/hooks/secrets-guard.sh)     | before a write           | refuses a live API key into any file git tracks                   |
| [spec-guard.sh](.claude/hooks/spec-guard.sh)           | before a write           | refuses hand edits to generated `openspec/specs/**`               |
| [pre-commit-gate.sh](.claude/hooks/pre-commit-gate.sh) | before `git commit`      | requires `/simplify` + `/code-review`, then typecheck, lint, Jest |
| [format.sh](.claude/hooks/format.sh)                   | after a write            | Prettier, using the project's own config                          |
| [test-companion.sh](.claude/hooks/test-companion.sh)   | after a source write     | reports a missing or stale companion spec                         |
| [docs-sync.sh](.claude/hooks/docs-sync.sh)             | after `openspec archive` | revalidates specs, checks rule links and README sections          |

The commit gate is satisfied by running `.claude/hooks/mark-reviewed.sh` after both review skills
have been run over the staged tree. It is bound to the staged tree id, so re-staging re-arms it.

## Testing

Two runners: Jest for logic, Cypress for boundaries. The suite runs offline with no API key.
What that means in practice is [.claude/rules/testing.md](.claude/rules/testing.md).

## Documentation

This file carries orientation and a rule index. Conventions, examples and detail go in a rule. If
something here starts explaining _how_ to do something, it belongs in a rule instead.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

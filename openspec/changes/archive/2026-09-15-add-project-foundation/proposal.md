## Why

There is a Next.js scaffold and nothing else. Every later change needs somewhere to put a case, a
run and a trace, and something deterministic to reason over.

The seed matters more here than it usually would. This project's central claim is that a
non-deterministic agent can be verified, and that claim rests on fixtures that do not move: the
same advertiser, the same rate card, the same prohibited vertical, the same injection attempt in
the same message body. If the seed varies, every assertion downstream becomes a coin flip and the
suite stops being evidence.

## What Changes

- A Prisma schema over SQLite covering the seven entities the workflow needs: `InboundMessage`,
  `Case`, `Run`, `RunStep`, `Assessment`, `Approval`, plus the two reference tables the tools read,
  `RateCardPackage` and `PolicyRule`.
- The first migration, and a Prisma client held as a hot-reload-safe singleton.
- A deterministic seed with fixed ids and fixed dates: a rate card, a policy table, and six inbound
  messages chosen to cover the paths that matter — an ordinary brief, a prohibited vertical, a
  restricted one, a message carrying a prompt-injection attempt, a non-brief, and a brief missing
  its budget.
- `src/lib/config.ts`, parsing the environment with Zod at module load so a missing or malformed
  setting fails at startup rather than on the first agent run.
- A Pino logger configured with redaction paths, and `GET /api/health` reporting database
  reachability.
- The shared error envelope and its helper, used by every endpoint from here on.

## Capabilities

### New Capabilities

- `platform-foundation`: what the system stores about an enquiry and its processing, what the seed
  guarantees, how configuration is validated, and what is observable before any agent exists.

### Modified Capabilities

None — this is the first change.

## Impact

- Fixes the trace shape that `add-agent-orchestrator` writes and the console later renders.
  Choosing rows over a JSON blob now is what lets the console page a trace without loading a run.
- The seed becomes a fixture contract. Later changes extend it but must not alter existing ids or
  field values, because Cypress and the guardrail suite will assert against them by name.
- No agent, no model call and no tool exists after this change. `ANTHROPIC_API_KEY` is read and
  validated but nothing uses it yet, which is deliberate: configuration failures should surface
  before the first change that spends money.

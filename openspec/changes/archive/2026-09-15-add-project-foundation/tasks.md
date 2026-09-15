## 1. Configuration

- [x] 1.1 Add `src/lib/config.ts` parsing `process.env` with Zod once at module load and exporting a typed frozen object
- [x] 1.2 Require `DATABASE_URL`; treat `ANTHROPIC_API_KEY` as optional so the console and the test suite start without one
- [x] 1.3 Coerce `AGENT_MAX_STEPS` and `AGENT_TIMEOUT_MS` to positive integers with defaults, so a malformed value fails at startup rather than becoming `NaN` in the run loop
- [x] 1.4 Export `AppConfig` as `z.infer` of the schema rather than declaring a parallel type
- [x] 1.5 Throw on a parse failure with a message naming the offending setting

## 2. Data model

- [x] 2.1 Add `prisma/schema.prisma` with the SQLite datasource and `InboundMessage`, `Case`, `Run`, `RunStep`, `Assessment`, `Approval`, `RateCardPackage`, `PolicyRule`
- [x] 2.2 Store tool inputs and outputs on `RunStep` as JSON string columns, with the shape owned by a Zod schema rather than by the column
- [x] 2.3 Add `@@unique([runId, index])` on `RunStep` so two steps cannot claim the same position in a trace
- [x] 2.4 Cascade deletes from `Case` to `Run` to `RunStep`, and index every foreign key
- [x] 2.5 Use no engine-specific column types, so the same migration applies against PostgreSQL unchanged
- [x] 2.6 Generate the first migration with `prisma migrate dev --name init`
- [x] 2.7 Add `src/lib/db.ts` exporting a Prisma client held as a `globalThis` singleton, so Next's dev-server reloads do not exhaust connections

## 3. Seed

- [x] 3.1 Add `prisma/seed.ts` using fixed ids and fixed ISO dates throughout — no `cuid()`, no `new Date()`, no randomness
- [x] 3.2 Seed `RateCardPackage` rows across display, video, audio and newsletter, with unit prices, available volume and flight windows
- [x] 3.3 Seed `PolicyRule` rows covering prohibited verticals, verticals requiring review, and the disclosure requirements that apply to the rest
- [x] 3.4 Seed an ordinary complete brief that can be quoted end to end
- [x] 3.5 Seed a brief in a prohibited vertical
- [x] 3.6 Seed a brief in a vertical requiring extra review
- [x] 3.7 Seed a message whose body contains an instruction addressed to the agent, for the injection suite to assert against
- [x] 3.8 Seed a message that is not an advertising brief at all
- [x] 3.9 Seed a brief missing the budget needed to quote
- [x] 3.10 Export the seeded ids as named constants so tests refer to fixtures by name rather than by position

## 4. Observability

- [x] 4.1 Add `src/lib/observability/logger.ts` configuring Pino with `LOG_LEVEL` from config
- [x] 4.2 Configure redaction paths covering the inbound message body, draft replies and any credential-bearing field
- [x] 4.3 Export a `child` helper that binds `runId` and `caseId`, so correlation is the default rather than something each call site remembers

## 5. HTTP

- [x] 5.1 Add `src/lib/http/errors.ts` with the `{ error: { code, message, fieldErrors? } }` envelope and an `errorResponse` helper
- [x] 5.2 Define the error codes as a union type so a handler cannot invent one
- [x] 5.3 Add `GET /api/health` reporting database reachability, 200 when reachable and 503 with a code when not
- [x] 5.4 Log the driver error on a health failure rather than returning it

## 6. Tests

- [x] 6.1 Jest — config parses a valid environment and rejects a missing `DATABASE_URL`, naming it
- [x] 6.2 Jest — config rejects a non-integer and a negative `AGENT_MAX_STEPS`
- [x] 6.3 Jest — config parses successfully with no `ANTHROPIC_API_KEY`, proving the suite can run without one
- [x] 6.4 Jest — the seed module exposes every documented fixture id, and the injection and prohibited-vertical fixtures are present
- [x] 6.5 Jest — the logger redacts a message body and a credential field at `info`
- [x] 6.6 Jest — `errorResponse` produces the envelope with the right status and code
- [x] 6.7 Jest — deleting a `Case` cascades to its `Run` and `RunStep` rows, leaving no step referencing a deleted run
- [x] 6.8 Jest — `RunStep` rows for a run read back in `index` order, and a second step cannot claim an index already taken
- [x] 6.9 Jest — the case references its inbound message rather than copying the body onto itself
- [x] 6.10 Jest — no `NEXT_PUBLIC_` setting carries a credential, so nothing server-only can reach the browser bundle through config
- [x] 6.11 Cypress — `GET /api/health` answers 200 against the seeded database
- [x] 6.12 Cypress — seeding twice leaves the fixture ids and values unchanged

## 7. Documentation and close out

- [x] 7.1 Record for the README: the SQLite-to-PostgreSQL swap is a datasource URL plus a provider line, and nothing else
- [x] 7.2 Record for the README: no agent, tool or model call exists yet, and the key is validated but unused
- [x] 7.3 Run `npm run typecheck && npm run lint && npm test` clean
- [x] 7.4 Run `npm run db:reset && npm run e2e` clean
- [x] 7.5 Run `npm run spec:validate`
- [x] 7.6 Archive the change, write the generated spec's Purpose, and act on what the docs-sync hook reports

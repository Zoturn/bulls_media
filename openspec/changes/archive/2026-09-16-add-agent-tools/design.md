## Context

This change builds the five leaf functions the orchestrator will call. Nothing here calls a model
or a loop; the goal is a fixed, fully-tested surface the next change can trust without
re-verifying. Two gaps surfaced while designing the arithmetic that the schema from
`add-project-foundation` did not anticipate, both fixed here with a follow-up migration rather than
by hand-editing the committed one (`.claude/rules/data-model.md` rule 11).

## Decisions

### The search corpus is built from `RateCardPackage`, not a separate `content/` directory

**Chosen:** `search_rate_card`'s MiniSearch index is built at module load from the seeded
`RateCardPackage` rows, converting each into a searchable document (name, channel, format).

**Alternatives considered:** hand-authoring `content/rate-card.md` and `content/policy.md` as
prose documents for MiniSearch to index, which is what `CLAUDE.md`'s original layout sketch
assumed and is closer to a literal "search over local docs" tool. Rejected once actually designing
it: the same five packages would then exist in two places — the document and the seed data — with
nothing keeping them in agreement, which is exactly the kind of duplication this project's own
rules argue against elsewhere. `CLAUDE.md` and `.prettierignore` are updated in this change to
remove the stale plan.

**Consequence:** the tool still satisfies "search over local docs" in substance — MiniSearch, an
offline lexical index, ranked results — the "docs" are just rows rather than files. If a genuine
free-text corpus (an actual policy handbook) is wanted later, it can be added without touching this
tool's contract.

### A `pricingUnit` column, added by a new migration in this change

**Problem found while designing `calculate_quote`:** `unitPriceCents` means different things per
seeded row — "per 1,000 impressions" for display/video/audio, "per send" for the newsletter
package — and the schema from `add-project-foundation` only recorded this as a code comment in
`prisma/seed-data.ts`, not as data. A tool cannot correctly price a newsletter send by dividing by 1000.

**Chosen:** add `pricingUnit String` (`PER_THOUSAND` | `PER_UNIT`) to `RateCardPackage` via a new
migration, and a matching `RATE_CARD_PRICING_UNITS` entry in `src/lib/domain/enums.ts`.

**Alternatives considered:** inferring the unit from `channel` (`newsletter` → per-unit, everything
else → per-thousand). Rejected because it hardcodes a pricing rule into a channel check that has
nothing to do with pricing, and breaks the moment a channel needs a different model for one
package — exactly the kind of implicit coupling `.claude/rules/data-model.md` warns against.

**Consequence:** this is a genuine schema change to a capability from a different, already-archived
change. It is additive (a new column with an explicit value for every existing seeded row) and
does not touch the committed `20260915185321_init` migration.

### Volume discount is proportional to a package's own available volume, not an absolute threshold

**Chosen:** the discount tier is based on `requestedVolume / availableVolume` for the specific
package being priced — under 25% of what remains: no discount; 25–49%: 5%; 50–79%: 10%; 80%+: 15%.

**Alternatives considered:** fixed absolute thresholds (e.g. 500,000 / 2,000,000 / 5,000,000
impressions). Rejected because the seeded packages range from 40 units (newsletter sends) to
5,000,000 (display impressions) — one absolute scale cannot mean the same thing for both, whereas
"how much of what's available is this buyer taking" is a coherent question regardless of unit.

**Deterministic check:** the engine is a pure function of `(unitPriceCents, pricingUnit,
availableVolume, requestedVolume)` — four numbers and an enum in, three numbers out — so every
boundary (24%/25%, 49%/50%, 79%/80%) is a table-driven unit test with an exact expected total.

### `lookup_inventory` stays a separate tool from `search_rate_card`

**Chosen:** searching returns packages with their available volume as of the search; confirming
availability for a specific package and a specific requested volume is a separate, later call.

**Alternatives considered:** folding availability confirmation into `search_rate_card`'s results,
since today's data model has no reservation mechanism and the two would return the same number.
Kept separate anyway: the orchestration rule that only `calculate_quote` may rely on a volume
figure needs one call that means "this number is authoritative right now," and conflating that
with a browsing result is the seam a future reservation system would have to cut along later
regardless. Building the seam now costs one small tool; building it later means changing
`search_rate_card`'s contract after the orchestrator already depends on it.

### `save_case` rejects a second save for the same run using the schema's own constraint

**Chosen:** `Assessment.runId` is already `@unique` (from `add-project-foundation`). The service
attempts the create and maps a Prisma `P2002` (unique constraint) error to a typed
`{ ok: false, reason: 'ALREADY_SAVED' }` result, rather than adding an application-level
existence check first.

**Alternatives considered:** a `findUnique` check before the `create`. Rejected as a
check-then-act race with no benefit here — the unique constraint already makes the create itself
atomic and correct; a separate check only adds a redundant round trip and a window between the
check and the write.

### Services take an injectable Prisma client, and a shared `testDb` factory replaces per-file setup

**Problem found while writing the first service test:** `rateCard.ts` initially hard-imported the
`db` singleton from `add-project-foundation`. That singleton is cached on `globalThis` outside
production, so a test cannot swap in a disposable, freshly-seeded database the way
`config.spec.ts`'s `jest.resetModules()` pattern swaps in a different environment — the cached
client survives a module reset.

**Chosen:** every service function takes an optional `PrismaClient` parameter, defaulting to the
singleton (`listRateCardPackages(client: PrismaClient = db)`); real call sites pass nothing, a
test passes a disposable client. `prisma/schema.spec.ts`'s migrate-and-cleanup logic — already
written in `add-project-foundation` — is extracted into `src/lib/testing/testDb.ts` so every
service-level integration test (`rateCard.spec.ts`, `policy.spec.ts`, `cases.spec.ts`, and
`schema.spec.ts` itself, refactored to use it) shares one implementation of "a real, disposable,
migrated SQLite database" rather than four copies of the same `execFileSync` dance.

**Alternatives considered:** `jest.mock('@/lib/db')` to replace the singleton per test file.
Rejected as more indirection for the same result, and it would not have helped `cases.spec.ts`
and `rateCard.spec.ts` share a lifecycle helper the way an explicit factory does.

### `callTool` takes an untyped tool, deliberately — a real variance limit, not a shortcut

**Problem found while writing the first tool-level test:** the AI SDK's `Tool<INPUT, OUTPUT>` is
contravariant in `execute`'s `INPUT` (and in `needsApproval`), so no concretely-typed tool this
project builds — `Tool<{ query: string }, ...>`, say — can ever be assigned to a shared helper
parameter typed `Tool<unknown, OUTPUT>` or `{ execute: (input: unknown, ...) => ... }`. That is
correct TypeScript variance, not a gap in how this project's tools are typed.

**Chosen:** `src/lib/testing/callTool.ts` types its `tool` parameter `any`, with an
`eslint-disable` and a comment explaining why, rather than fighting the SDK's generic structure in
test-only helper code. Runtime safety is unaffected — every tool still validates its own input
against its Zod `inputSchema` regardless of what a test passes it.

**Alternatives considered:** giving `callTool` its own `INPUT` type parameter inferred from the
tool argument. Tried first; still fails, because the incompatibility is in assigning the concrete
`execute` function _to_ a generic parameter position, not in failing to infer a type — inference
doesn't change which direction contravariance runs.

### The test-database template migrates once per run, not once per worker

**Problem found during `/code-review`:** `createTestDb`'s per-worker "migrate once, then copy"
cache (see the DI addendum above) only dedupes calls _within_ one Jest worker process. Jest
schedules test files across several workers by default, and this change's suite spreads 9+
DB-touching spec files across up to `os.cpus().length` of them — so several workers could each
still pay the ~1.15s `prisma migrate deploy` cost for what is, every time, an identical template.
Measured: the full suite ran in 11-12s with the per-worker cache alone.

**Chosen:** `jest.globalSetup.ts` runs the migration exactly once, in Jest's own main process,
before any worker starts, against a fixed path in the OS temp directory (no process id in the
name — the whole point is one file every worker shares); `jest.globalTeardown.ts` removes it once
the whole run finishes. `createTestDb` now only ever copies that already-migrated template and
throws a clear, actionable error if it is missing, rather than silently trying to re-migrate
(which would risk two workers racing on the same file).

**Consequence:** the full suite now runs in under 2 seconds warm. `globalSetup`/`globalTeardown`
are `.ts`, not `.js` — Jest 28+ runs them through the configured transform, so they get the same
`import` syntax, and the same typecheck coverage, as everything else in the repo.

## Risks

- **The new migration touches a table `platform-foundation` owns.** Mitigated by keeping the
  change additive and re-running that change's own schema-level tests (`prisma/schema.spec.ts`)
  after the migration, not just this change's new ones.
- **MiniSearch's ranking could change with its own version upgrades**, which would silently
  reorder `search_rate_card` results. Mitigated by the tests asserting on set membership and
  exclusion (which package is present or absent), not on exact rank order.
- **The proportional discount reads `availableVolume` as static.** Once reservations exist, two
  concurrent quotes could both see the same "remaining" volume. Out of scope here; the README will
  carry this as a limitation once the orchestrator makes it possible to observe.

## 1. Schema: pricing unit

- [x] 1.1 Add `pricingUnit String` to `RateCardPackage` in `prisma/schema.prisma`, with a comment naming the two values `PER_THOUSAND | PER_UNIT`
- [x] 1.2 Generate a new migration (`prisma migrate dev --name add_pricing_unit`) — never edit `20260915185321_init`
- [x] 1.3 Add `RATE_CARD_PRICING_UNITS` / `rateCardPricingUnitSchema` / `RateCardPricingUnit` to `src/lib/domain/enums.ts`
- [x] 1.4 Set `pricingUnit` explicitly on every seeded package in `prisma/seed-data.ts`: `PER_THOUSAND` for display/video/audio, `PER_UNIT` for the newsletter package
- [x] 1.5 Type `RATE_CARD`'s `pricingUnit` field as `RateCardPricingUnit`, not a hand-written union
- [x] 1.6 Extend `enums.spec.ts` (or `seed-data.spec.ts`) to assert every seeded package's `pricingUnit` is a valid member of the enum

## 2. Engines (pure, offline, no Prisma import)

- [x] 2.1 `src/lib/tools/engines/policy.ts`: `matchPolicy(rules, vertical)` — case-insensitive match, defined fallback decision when nothing matches
- [x] 2.2 `src/lib/tools/engines/rateCardSearch.ts`: `buildRateCardIndex(packages)` returning a MiniSearch instance over `{ id, name, channel, format }`; `searchRateCard(index, query, channel?)` returning ranked matches, channel-filtered before or after scoring so an excluded package never appears
- [x] 2.3 `src/lib/tools/engines/inventory.ts`: `checkInventory(packages, packageId, requestedVolume)` returning available / unavailable-with-actual-volume / not-found as a discriminated result
- [x] 2.4 `src/lib/tools/engines/quote.ts`: `calculateQuote(packages, lineItems)` — per line item, price by `pricingUnit` (`unitPriceCents * volume / 1000` for `PER_THOUSAND`, `unitPriceCents * volume` for `PER_UNIT`), apply the proportional discount tier from `requestedVolume / availableVolume` (< 25%: 0%, 25–49%: 5%, 50–79%: 10%, ≥ 80%: 15%), sum across items, integer cents throughout with `Math.floor` on each computed discount
- [x] 2.5 Every engine returns a discriminated `{ ok: true, data }` / `{ ok: false, reason }` result per `.claude/rules/agent-tools.md` rule 7

## 3. Services

- [x] 3.1 `src/lib/services/rateCard.ts`: `listRateCardPackages()` with an explicit `select` of every column the engines need
- [x] 3.2 `src/lib/services/policy.ts`: `listPolicyRules()` with an explicit `select`
- [x] 3.3 `src/lib/services/cases.ts`: `saveAssessment(runId, assessment)` — creates the `Assessment` row; catches a Prisma `P2002` on `runId` and returns `{ ok: false, reason: 'ALREADY_SAVED' }`; catches a foreign-key failure (no such `Run`) and returns `{ ok: false, reason: 'RUN_NOT_FOUND' }`
- [x] 3.4 `saveAssessment` writes only the fields `save_case`'s contract allows — disposition, structured result, quote total when disposition is `QUOTED`, refusal reason when `REFUSED`, draft reply when present — and nothing else

## 4. Tools

- [x] 4.1 `src/lib/tools/checkAdPolicy.ts`: `createCheckAdPolicyTool(client?)` returning `tool({ description, inputSchema, outputSchema, execute })`, wiring `listPolicyRules` + `matchPolicy` — a factory, not a bare `tool()` call, so a test can inject a disposable database (see design.md's DI addendum)
- [x] 4.2 `src/lib/tools/searchRateCard.ts`: `createSearchRateCardTool(client?)` builds the MiniSearch index once per tool instance (cached in the factory's closure, not true module scope — each test's own instance gets its own index against its own database), reused across calls to that instance
- [x] 4.3 `src/lib/tools/lookupInventory.ts`: `createLookupInventoryTool(client?)`
- [x] 4.4 `src/lib/tools/calculateQuote.ts`: `createCalculateQuoteTool(client?)`
- [x] 4.5 `src/lib/tools/saveCase.ts`: `createSaveCaseTool(client?)`, calling `saveAssessment` — never Prisma directly
- [x] 4.6 Every tool's `inputSchema` and output schema are Zod, exported so a test can validate against the same schema the tool itself uses
- [x] 4.7 `src/lib/tools/index.ts` exporting all five default-constructed tools as one `ToolSet` object (`agentTools`), ready for `add-agent-orchestrator` to import, plus every `create*Tool` factory for tests
- [x] 4.8 Every tool `description` is written for the model (when to call it, what comes back), per `.claude/rules/agent-tools.md` rule 6

## 5. Tests

- [x] 5.1 Jest — `matchPolicy`: seeded vertical, case-insensitivity, unrecognised vertical falls back, empty/whitespace vertical rejected by the tool's input schema
- [x] 5.2 Jest — `searchRateCard`/`buildRateCardIndex`: a matching query returns the package, a non-matching query returns an empty list with `ok: true`, a channel filter excludes an otherwise-matching package, an instruction-shaped query is scored as inert text with no special-cased behaviour
- [x] 5.3 Jest — `checkInventory`: enough volume, not enough volume (states the actual available volume), unknown package id distinct from zero availability, requested volume of zero or negative rejected by the tool's input schema
- [x] 5.4 Jest — `calculateQuote`: below the first discount tier, at and just past each of the three tier boundaries (24%/25%, 49%/50%, 79%/80%), multiple line items summed correctly, an unknown package id fails naming it and computes no partial total, two calls with identical input produce byte-identical output
- [x] 5.5 Jest — `calculateQuote` correctly prices a `PER_UNIT` package (the newsletter package) without dividing by 1000
- [x] 5.6 Jest — `saveAssessment` against a real seeded test database (pattern from `prisma/schema.spec.ts`, extracted into the shared `src/lib/testing/testDb.ts`): saving a quoted assessment persists the quote; saving a refused assessment persists no quote regardless of what was passed; saving against a nonexistent run fails; saving twice against the same run fails on the second attempt and the first `Assessment` is unchanged
- [x] 5.7 Jest — every tool's Zod input schema rejects the malformed inputs named in the spec (empty vertical, non-positive volume, etc.) before `execute` runs
- [x] 5.8 Jest — every engine test constructs its input as plain fixture data with no Prisma client involved, proving the "pure, offline engine" requirement directly

## 6. Documentation and close out

- [x] 6.1 Record for the README: the five tools now exist and are individually tested, but nothing calls them yet — no orchestrator, no refusal enforcement (that is `add-agent-guardrails`'s job)
- [x] 6.2 Run `npm run typecheck && npm run lint && npm test` clean
- [x] 6.3 Rerun `prisma/schema.spec.ts` specifically after the new migration, confirming `add-project-foundation`'s own guarantees still hold
- [x] 6.4 Run `npm run db:reset && npm run e2e` clean
- [x] 6.5 Run `npm run spec:validate`
- [x] 6.6 Archive the change, write the generated spec's Purpose, and act on what the docs-sync hook reports

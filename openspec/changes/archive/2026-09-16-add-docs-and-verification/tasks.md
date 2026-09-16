## 1. Example generator

- [x] 1.1 `scripts/generate-examples.ts`: build a disposable, freshly migrated-and-seeded SQLite
      database the same way `jest.globalSetup.ts` builds its test template (`prisma migrate
  deploy` against a scratch path, then `seedDatabase`), so the script touches neither `dev.db`
      nor Jest's own template mechanism
- [x] 1.2 For each of the six seeded business-case messages (`ordinaryBrief`, `prohibitedVertical`,
      `reviewVertical`, `injectionAttempt`, `notABrief`, `missingBudget`), open a case and run
      `executeRun` with a `scriptedModel` whose steps mirror a plausible real model for that case —
      reusing the exact scripted flows already proven in `run.spec.ts`/`injection.spec.ts` where
      one exists, writing a new one only for the case that has none yet (`missingBudget`,
      `NEEDS_INFO`)
- [x] 1.3 For each run, read back the message, every `RunStep` row (type, tool name, input,
      output, error, duration) and the saved `Assessment`, and render one Markdown file to
      `examples/<slug>.md`: the inbound message, the trace in order, then the assessment's summary,
      structured result, and quote/refusal/missing-fields/review-reason as the disposition has
      — never composing a total or decision the generator invented itself
- [x] 1.4 Clean up the disposable database (disconnect, remove the file and its SQLite sidecars)
      whether generation succeeds or throws
- [x] 1.5 `package.json`: add `"examples:generate": "tsx scripts/generate-examples.ts"`
- [x] 1.6 Run it once and commit the six resulting files under `examples/`

## 2. README

- [x] 2.1 Replace the "Example inputs and outputs" placeholder with a short intro plus a link and
      one-line description for each of the six committed examples, matching the "Business cases
      covered" table's order
- [x] 2.2 Update "Implementation status": mark `add-docs-and-verification` **done**, remove the
      top status banner's "still to come" line
- [x] 2.3 "How to test and verify": document the `npm run e2e` single-dev-server-per-project
      gotcha (Next 16, not this project's Cypress config) and what to do about it
- [x] 2.4 "How to test and verify": name which seeded message demonstrates which business case in
      the manual verification walk, rather than "open any listed message"

## 3. Verify and close out

- [x] 3.1 Run `npm run typecheck && npm run lint && npm test` clean
- [x] 3.2 Run `npm run db:reset && npm run e2e` clean, with no other dev server for this project
      running
- [x] 3.3 Run `npm run spec:validate`
- [x] 3.4 Archive the change, write the generated spec's Purpose, and act on what the docs-sync
      hook reports

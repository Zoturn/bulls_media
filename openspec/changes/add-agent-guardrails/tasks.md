## 1. Untrusted text, lifted out and widened

- [x] 1.1 `src/lib/guardrails/untrusted.ts`: move `UNTRUSTED_DELIMITERS`, the delimiter-shaped regex and `neutralise` out of `src/lib/agent/prompt.ts`; export `neutralise(text)` and `renderUntrusted(message)`
- [x] 1.2 `src/lib/agent/prompt.ts` imports them rather than defining them; its spec keeps passing unchanged
- [x] 1.3 Apply `neutralise` to the model-visible strings in `search_rate_card`'s results (package name, format) so a delimiter planted in seeded content cannot close the untrusted block
- [x] 1.4 Jest — a rate-card row whose name contains the closing delimiter is neutralised in the tool's output; an ordinary row is returned unchanged

## 2. Post-conditions (pure, no database, no model)

- [x] 2.1 `src/lib/guardrails/postconditions.ts`: `AssessmentClaim` — the normalised shape both boundaries produce (`disposition`, `vertical`, `quoteCents`, `hasQuote`)
- [x] 2.2 `claimFromSaveCaseInput(input)` and `claimFromAssessment(assessment)` — the two adapters, so the check itself never knows which boundary called it
- [x] 2.3 `checkPostConditions(claim, history)` returning `PostConditionViolation[]`, each naming the check, what was claimed and what the recorded tool result said
- [x] 2.4 Check: a `QUOTED` claim's total equals a total `calculate_quote` returned on this run (any recorded result, not only the last — see design.md on legitimate revision)
- [x] 2.5 Check: a `QUOTED` claim on a run with no successful `calculate_quote` result is a violation
- [x] 2.6 Check: a `REFUSED` claim carrying a quote is a violation
- [x] 2.7 Check: the claimed vertical is one `check_ad_policy` was actually asked about on this run
- [x] 2.8 Check: a disposition that contradicts the recorded policy decision is a violation
- [x] 2.9 `src/lib/guardrails/refusal.ts`: `enforcedStatusFor(history, disposition)` — `REFUSE` on record wins, per .claude/rules/guardrails-and-injection.md rule 4
- [x] 2.10 `refusalEvidence(history)` — the rule id and vertical behind the refusal, so a refusal explains itself (rule 10)
- [x] 2.11 Jest — a table over every check: violated and clean, both sides of each boundary, plus an empty history

## 3. Enforcement at the write boundary

- [x] 3.1 `saveCaseOutputSchema` gains a `POST_CONDITION_FAILED` failure variant carrying the violations
- [x] 3.2 The run-bound `save_case` tool takes the run's recorded tool results and checks the claim before writing; a violation returns the failure and writes nothing
- [x] 3.3 The tool's `description` tells the model what that failure means and that it may correct and call again — it is a result to act on, not an error to report
- [x] 3.4 Jest — a violating call writes no row and returns the violations; a corrected second call succeeds

## 4. Enforcement at run close

- [x] 4.1 `executeRun` checks the structured answer's claim against the same history before deriving a status
- [x] 4.2 A violation closes the run `FAILED` with the violations recorded, rather than `COMPLETED` on the model's say-so
- [x] 4.3 `enforcedStatusFor` is applied before the disposition mapping, so a `REFUSE` on record produces `REFUSED` whatever the model returned
- [x] 4.4 Violations are written to the `TERMINAL` step and summarised in the run's `errorMessage`, so an operator sees which check failed against which tool result
- [x] 4.5 Jest — policy `REFUSE` + model `QUOTED` ends `REFUSED`, records the violation, and persists no quote anywhere

## 5. The injection corpus

- [x] 5.1 `prisma/seed-data.ts`: grow the corpus to cover instruction-in-body (exists), instruction-in-subject, instruction-in-sender-name, a forged delimiter, a claimed prior approval, and a claimed policy exception on a refused vertical
- [x] 5.2 Every fixture keeps a fixed id, a fixed `receivedAt` and realistic surrounding copy — an injection that reads like an injection tests nothing about the realistic case
- [x] 5.3 `src/lib/guardrails/injection.spec.ts`: drive each fixture through `executeRun` with a scripted model that _obeys_ the injection, and assert on behaviour only
- [x] 5.4 No assertion anywhere in the guardrail suite matches refusal wording (.claude/rules/testing.md rule 8)
- [x] 5.5 Jest — the seed-determinism guarantee still holds with the enlarged corpus

## 6. Documentation and close out

- [x] 6.1 Record for the README: what is enforced deterministically, and — in plain words — what is not: no semantic detection of instructions, and no check that the model classified the vertical correctly
- [x] 6.2 Record where `add-agent-orchestrator`'s two-writers risk is closed — in THIS change's design.md, not by editing the archived one, which was accurate when written
- [x] 6.3 Run `npm run typecheck && npm run lint && npm test` clean
- [x] 6.4 Run the Cypress suite clean on a free port (`npm run e2e` reuses a foreign server on 3000 — see the queued task)
- [x] 6.5 Run `npm run spec:validate`
- [x] 6.6 Archive the change, write the generated spec's Purpose, and act on what the docs-sync hook reports

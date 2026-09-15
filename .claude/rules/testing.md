---
paths:
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "cypress/**"
  - "jest.config.js"
  - "jest.setup.ts"
---

# Testing

**Scope:** What is tested, with which of the project's two runners, and what a test must prove. It does not define the behaviour under test; the specs do that.

## Rules

1. Use Jest for pure logic — the tools and their engines, the guardrails, the validation schemas, and the orchestrator driven by a mock model — because those have no boundary to cross and deserve tests that run in milliseconds.
2. Use Cypress for anything crossing a boundary: API behaviour through `cy.request`, and the operator's flow through the browser, since a guarantee about HTTP is only proven over real HTTP.
3. Drive the orchestrator in Jest with `MockLanguageModelV4` from `ai/test`, scripting the tool calls the model would make, because that is what turns "the agent handles a refusal correctly" from an anecdote into an assertion.
4. Require the whole suite to run offline with no API key: `jest.setup.ts` deletes the provider keys, so a test that quietly passes on the author's machine because a key was exported will fail everywhere else, which is the correct outcome.
5. Place unit specs beside the code they cover as `*.spec.ts`, so a reader opening a module immediately sees whether it is tested and a deleted module takes its test with it.
6. Reset and reseed with `npm run db:reset` before a Cypress run, so every assertion starts from the same fixtures rather than from whatever the last run left behind.
7. Assert against seeded records by name or id, never "the first case in the list", because an order-dependent test passes and fails for reasons unrelated to the change being made.
8. Test the injection corpus by behaviour — the tool was not called, no quote exists, the disposition is `REFUSED` — and never by matching refusal wording, since asserting on prose tests the copywriting and breaks on an edit.
9. Assert that a refused case has no quote and that a quoted case's total equals what `calculate_quote` returned, because those two post-conditions are the deterministic checks that make a non-deterministic step trustworthy.
10. Test both sides of every limit and the empty value — a budget at and below the minimum, a flight window of zero days, a message of zero length — as an off-by-one in a boundary check is the first thing a reviewer probes.
11. Assert on the error envelope's `code` and the HTTP status rather than on message wording, so tests survive copy changes but still catch a contract break.
12. Cover the run that fails: a tool that throws, a model returning an unparseable result, a step budget exhausted. A happy-path-only agent suite proves nothing about the paths that cost money.
13. Treat a task as complete when its test passes, not when its code exists, since untested code is a claim rather than a result.

## Examples

```ts
// no: reaches a real provider, so a failure is ambiguous between a bug and an outage
const model = anthropic('claude-sonnet-5');

// yes: the model's decisions are the test's fixture
const model = new MockLanguageModelV4({
  doGenerate: mockValues(
    toolCallResult('check_ad_policy', { vertical: 'gambling' }),
    textResult('I cannot quote for this enquiry.'),
  ),
});
```

```ts
// no: asserts on prose, so a copy edit turns a security test red
expect(result.summary).toContain('I cannot help');

// yes: asserts on behaviour, which is what the guarantee actually is
expect(result.disposition).toBe('REFUSED');
expect(result.quote).toBeNull();
expect(toolNames(trace)).not.toContain('calculate_quote');
```

```ts
// yes: the violation attempted over real HTTP, asserted on the contract
cy.request({ method: 'POST', url: '/api/runs', body: {}, failOnStatusCode: false }).then((res) => {
  expect(res.status).to.eq(400);
  expect(res.body.error.code).to.eq('VALIDATION_ERROR');
});
```

## Anti-patterns

- Tests that only exercise the happy path, leaving every guarantee the brief grades unverified.
- Mocking a guardrail inside an end-to-end test, which proves the mock returns what it was told to.
- A test that reaches the network, making a failure ambiguous between a bug and someone else's outage — and billing the author for `npm test`.
- Depending on records left by a previous run, so the suite passes locally and fails on a clean checkout.
- Asserting `toBeTruthy()` on a response, which passes for a refusal as readily as for the quote that was meant.

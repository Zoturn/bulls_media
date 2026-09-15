---
paths:
  - "src/lib/tools/**"
---

# Agent tools

**Scope:** How a tool is defined, what its contract owes the caller, and which work belongs in a tool rather than in the model. It does not cover when the loop may call a tool; `agent-orchestration.md` does that.

## Rules

1. Define every tool with `tool({ description, inputSchema, execute })` and a Zod `inputSchema`, because that one schema is simultaneously the model's instructions, the runtime validation, and the TypeScript type — three things that cannot drift apart when they are one thing.
2. Validate the tool's own return value against an output schema before returning it, since a tool result flows straight back into the model's context and a malformed one is a defect that surfaces three steps later as a confusing hallucination.
3. Keep every tool deterministic and offline: same input, same output, no clock, no network, no randomness. This is what lets the whole suite run without an API key and makes a failure mean something.
4. Put all arithmetic in a tool — totals, discounts, pro-rating, CPM maths — because a model that can add is a model that can add wrongly, and no amount of prompting makes it auditable.
5. Put all policy decisions in a tool backed by data, not in prose in a prompt, so that changing what is refusable is a row and a test rather than a reworded paragraph nobody can diff.
6. Write the `description` for the model, describing when to reach for the tool and what it will get back; write the code comment for the next engineer. Conflating the two produces a description that helps neither.
7. Return a discriminated result — `{ ok: true, data }` or `{ ok: false, reason }` — rather than throwing for an expected outcome such as "no inventory matches", because an empty result is information the model should reason about, not an exception that kills the run.
8. Never let a tool mutate anything outside its stated contract, and keep the one write tool (`save_case`) the only write. A read tool with a side effect is untestable and makes a dry run impossible.
9. Treat every string a tool returns from seeded content as untrusted, exactly like inbound email, since a rate-card document is a document and whoever wrote it is not necessarily the operator.
10. Name tools as `verb_noun` in snake_case and keep names stable, because the name appears in the trace, in the tests and in the model's reasoning, and renaming one invalidates all three.
11. Give each tool a unit spec covering the empty result, the invalid input and the boundary case, not just the happy path — the happy path is the one the model will exercise anyway.

## Examples

```ts
// no: untyped input, arithmetic left to the caller, throws on a normal outcome
export async function searchRateCard(q: any) {
  const rows = await prisma.rateCard.findMany();
  if (!rows.length) throw new Error('nothing found');
  return rows;
}

// yes: one schema for the model, the runtime and the type; an empty result is data
export const searchRateCard = tool({
  description:
    'Find rate-card packages matching a channel, market or format. Returns matching packages ' +
    'with their unit price and available volume. Returns an empty list when nothing matches — ' +
    'that means we cannot sell it, not that the search failed.',
  inputSchema: z.object({
    query: z.string().min(2).max(200),
    channel: z.enum(CHANNELS).optional(),
  }),
  execute: async (input) => {
    const matches = index.search(input.query).slice(0, MAX_MATCHES);
    return searchResultSchema.parse({ ok: true, data: matches.map(toPackage) });
  },
});
```

```ts
// no: the model is asked to do the maths, so the total is unverifiable
description: 'Look up prices and work out the campaign total.';

// yes: the tool owns the number, and a test can pin it exactly
expect(calculateQuote({ items: [{ packageId: 'display-ros', impressions: 2_000_000 }] })).toEqual({
  ok: true,
  data: { subtotalCents: 1_600_000, discountCents: 160_000, totalCents: 1_440_000 },
});
```

## Anti-patterns

- A tool that calls the model, which turns a deterministic leaf into another non-deterministic branch and makes the trace a lie.
- Returning a bare array, so the model cannot tell "no matches" from "the search broke".
- Encoding the restricted-vertical list in the tool's `description` instead of in data, which makes policy invisible to tests.
- A tool whose `execute` reads `Date.now()` or `Math.random()`, so the same input produces a different trace on every run.
- Renaming a tool during a refactor and leaving the old name in the trace schema, breaking every stored run.

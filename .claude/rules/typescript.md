---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "tsconfig.json"
---

# TypeScript

**Scope:** Type strictness and where types come from. It applies everywhere in `src`, and most sharply at the boundaries where model output, tool results and HTTP payloads enter the program.

## Rules

1. Keep `strict` on and never disable a check locally, because every guarantee in this project is a claim about data crossing a boundary, and a loosened check is exactly where that claim stops being verified.
2. Never write `any`; lint treats it as an error. Where a type is genuinely unknown — a JSON column, a parsed tool result — use `unknown` and narrow it, so the narrowing is visible rather than assumed.
3. Derive types from Zod schemas with `z.infer` rather than declaring a parallel interface, since two hand-maintained descriptions of the same payload disagree eventually and the compiler cannot tell you which one is right.
4. Parse at the boundary and pass typed values inward: HTTP bodies, model output and tool results are validated once on entry, so no function downstream has to re-check what it was given.
5. Prefer a discriminated union over optional fields for states that cannot coexist — a run is refused or quoted, never both — because the compiler can then reject the impossible combination instead of a reviewer having to.
6. Use `satisfies` to check a literal against a type without widening it, keeping the literal's precision for inference while still failing on a typo.
7. Type function returns explicitly at module boundaries, since an inferred return type silently becomes part of the contract and changes without anyone reviewing it.
8. Model "absent" as `null` in persisted data and `undefined` for an argument not supplied, and stay consistent, because Prisma and JSON round-trips make the two distinguishable and mixing them produces bugs that only appear after a save-and-reload.
9. Avoid non-null assertions (`!`); if a value cannot be null, encode that in the type, and if it can, handle it. An assertion is a comment the compiler is forced to believe.

## Examples

```ts
// no: a parallel interface that will drift, and an `any` that erases the boundary
interface Brief {
  advertiser: string;
  budgetCents: number;
}
function parse(body: any): Brief {
  return body;
}

// yes: one schema, the type derived from it, validation at the boundary
export const briefSchema = z.object({
  advertiser: z.string().min(1).max(200),
  budgetCents: z.number().int().positive(),
});
export type Brief = z.infer<typeof briefSchema>;

export function parseBrief(body: unknown): Brief {
  return briefSchema.parse(body);
}
```

```ts
// no: optional fields let a refused case carry a quote
type Assessment = { disposition: string; quote?: Quote; refusalReason?: string };

// yes: the impossible combination will not compile
type Assessment =
  | { disposition: 'QUOTED'; quote: Quote }
  | { disposition: 'REFUSED'; refusalReason: string };
```

## Anti-patterns

- `as` used to silence a type error rather than to narrow a genuinely wider type, which moves the failure to runtime.
- A `catch (e: any)`, discarding what is known about the error at the one place it matters.
- Re-validating the same payload at three layers because no layer trusts the one before it, which is a sign the parse is in the wrong place.
- An exported function with an inferred return type that quietly changes shape when its implementation is refactored.

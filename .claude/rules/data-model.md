---
paths:
  - "prisma/**"
  - "src/lib/db.ts"
  - "src/lib/services/**"
---

# Data model

**Scope:** Schema conventions, migrations, the seed, and how services read and write. SQLite is the development datastore; the schema is written so that moving to PostgreSQL is a datasource change and nothing else.

## Rules

1. Keep the schema portable: no SQLite-specific types, no raw SQL that assumes one engine, and no reliance on SQLite's loose typing, because the whole claim that this productionises is the claim that the datasource line is the only thing that changes.
2. Store the run trace as rows, not as a JSON blob on the run, since the console pages and filters steps, and a blob makes every read load an entire run to show one step.
3. Store tool inputs and outputs as JSON string columns with a Zod schema owning their shape, because SQLite has no JSON column type and an unvalidated blob is a type error waiting for a redeploy.
4. Give every foreign key an index and every list query an ordering column, as a trace rendered in the wrong order is worse than no trace and an unindexed `runId` lookup is the query the console makes most.
5. Cascade deletes from case to run to step, so removing a case cannot leave orphaned steps that the console will later try to render.
6. Make the seed deterministic — fixed ids, fixed dates, no randomness — because Cypress asserts against it by name, and a seed that varies turns an assertion into a coin flip.
7. Seed the adversarial fixtures alongside the ordinary ones: a prohibited vertical, a message carrying an injection attempt, a brief with no budget. The failure paths are what the suite is for.
8. Use explicit `select` in every service query rather than returning whole records, so a column added later cannot leak into an API response by default.
9. Keep Prisma access inside `src/lib/services/**`; route handlers and components call services. A component that queries the database cannot be unit-tested without one.
10. Instantiate one Prisma client as a module singleton guarded for hot reload, because Next's dev server re-evaluates modules and a client per reload exhausts connections.
11. Treat a migration as immutable once committed; correct it with a new one, since editing an applied migration breaks every checkout that already ran it.

## Examples

```prisma
// yes: portable types, indexed FK, ordered steps, cascade from the parent
model RunStep {
  id         String   @id @default(cuid())
  runId      String
  index      Int
  type       String
  toolName   String?
  input      String?  // JSON, shape owned by a Zod schema
  output     String?  // JSON, shape owned by a Zod schema
  error      String?
  durationMs Int
  createdAt  DateTime @default(now())

  run Run @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, index])
  @@index([runId])
}
```

```ts
// no: returns whatever columns exist today, including ones added tomorrow
return prisma.case.findMany();

// yes: the response shape is stated, so it cannot drift
return prisma.case.findMany({
  select: { id: true, advertiser: true, status: true, receivedAt: true },
  orderBy: { receivedAt: 'desc' },
});
```

## Anti-patterns

- A `Json` column type copied from a PostgreSQL schema, which SQLite does not have and which breaks the portability claim in the README.
- A seed that uses `new Date()` or a random id, so the e2e suite asserts against different data on every run.
- Querying Prisma directly from a route handler, which puts an untestable database call in the HTTP layer.
- Editing a committed migration to fix a typo, leaving everyone who already migrated in a state no future migration accounts for.
- Storing the whole trace as one JSON field because it is convenient to write, making it expensive to read.

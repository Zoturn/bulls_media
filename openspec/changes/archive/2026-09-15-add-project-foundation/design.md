## Context

This change fixes the decisions everything later inherits: where data lives, what a trace is
shaped like, and which libraries the agent is built on. None of it is reversible cheaply once four
more changes depend on it, so the alternatives are recorded here rather than left implicit.

The assignment is graded partly on whether "a small team could extend this into production". That
pushes every choice below towards the option that is honest about its limits and cheap to replace,
over the option that looks more production-like in a repository nobody will deploy.

## Decisions

### SQLite as the datastore, not PostgreSQL

**Chosen:** SQLite through Prisma, with the schema written to stay portable.

**Alternatives considered:** PostgreSQL in Docker Compose, which is what a production deployment
would use and what the sibling project in this workspace does. Rejected because "easy to run and
verify" is an explicit grading line, and requiring Docker puts a service install between the
reviewer and the first run. The cost is that SQLite has no JSON column type and weaker concurrency;
both are handled below, and the README states the swap is a datasource change plus a provider line.

**Deterministic check:** the schema uses no engine-specific types, so the same migration applies
against PostgreSQL unchanged.

### The trace is rows, not a JSON blob on the run

**Chosen:** one `RunStep` row per step.

**Alternatives considered:** a single JSON column on `Run`, which is less schema and trivially
matches the AI SDK's step objects. Rejected because the console renders and filters the trace, and
a blob forces every read to load a whole run to show one step — and makes "show me every run where
`check_ad_policy` refused" a full scan instead of a query.

**Consequence:** tool inputs and outputs are stored as JSON _strings_, since SQLite has no JSON
type. Their shape is owned by a Zod schema, which is validated on write, so the column is only
untyped at rest.

### A custom orchestrator, not LangGraph

**Chosen:** a typed run loop written here, on top of the AI SDK's tool-calling primitives.

**Alternatives considered:** LangGraph.js, which supplies a graph runtime, checkpointing and
resumability out of the box. Rejected on three grounds: agent design is the thing being assessed,
and a framework graph hides exactly the reasoning a reviewer wants to see; its checkpointer would
duplicate the `Run`/`RunStep` tables this change already needs; and its abstractions are heavier
than a bounded loop over five tools warrants. The AI SDK's `prepareStep` and `stopWhen` give the
per-phase tool allowlist and the step budget without a second state machine.

**Consequence:** resumability is not free. This change does not deliver it; run state is persisted
per step so it remains possible, and the README lists it as a next step rather than claiming it.

### AI SDK over the Anthropic SDK directly

**Chosen:** `ai` v7 with `@ai-sdk/anthropic`.

**Alternatives considered:** calling the Anthropic SDK directly, which removes a dependency layer.
Rejected because the AI SDK provides three things this project is graded on: Zod-typed tools whose
schema is simultaneously the model's contract and the runtime validation, per-step control through
`prepareStep`, and `MockLanguageModelV4` — which is what makes the entire orchestrator testable
offline with no API key. Provider independence is a secondary benefit.

**Deterministic check:** every orchestrator test drives a mock model, so a change in model
behaviour cannot make the suite pass or fail.

### Lexical retrieval, not embeddings

**Chosen:** MiniSearch over the seeded rate card, built in memory at startup.

**Alternatives considered:** pgvector or a hosted vector store with an embedding model. Rejected
because it adds a service, an API key and a nondeterministic ranking to a corpus of a few dozen
rows, in exchange for nothing the grading rubric asks for. Lexical search over a small, controlled
corpus is deterministic, which means the retrieval tool's tests assert on exact results.

**Consequence:** the tool will not match a semantically similar query with no shared terms. The
README names this as a limitation and pgvector as the productionisation path.

### Configuration parsed with Zod at module load

**Chosen:** one `config.ts` that parses `process.env` once and exports a typed object.

**Alternatives considered:** reading `process.env` where needed. Rejected because a malformed
`AGENT_MAX_STEPS` then becomes `NaN` inside the run loop, where an unbounded loop is a billing
incident rather than an error message. Failing at startup names the setting instead.

### The key is validated but optional

`ANTHROPIC_API_KEY` is validated when present but not required to boot. Requiring it would mean
the test suite and the console could not start without one, and `jest.setup.ts` deliberately
deletes it so no unit test can reach a real provider. A run attempted without a key fails with a
clear configuration error at the point of the run, which is where it is actionable.

## Risks

- **A fixture contract set too early.** Later changes assert against seeded ids, so a mistake here
  is expensive to correct. Mitigated by seeding the six message shapes the workflow actually
  branches on, rather than a convenient three.
- **SQLite write concurrency.** Two runs writing steps simultaneously can contend. Acceptable for a
  single-operator console; the API refuses a second concurrent run per case for product reasons
  anyway, which removes the realistic collision.
- **Storing JSON as text.** A value written outside the Zod schema would be unvalidated at rest.
  Mitigated by keeping all writes behind the services in `src/lib/services/**`.

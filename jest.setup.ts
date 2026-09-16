/**
 * Runs before every Jest suite.
 *
 * The point is that the unit suite cannot reach a model provider even by accident. A test that
 * quietly succeeds because someone's key happened to be exported is not a test of this codebase,
 * and one that bills a real account for running `npm test` is worse. The orchestrator is driven by
 * a mock model in every Jest spec; anything that tries to construct a real client here should fail
 * loudly on a missing key rather than silently work on the author's machine.
 */

// What the developer's own shell actually had, before anything below has a chance to overwrite
// it from the project's .env file — captured now because the next line makes that distinction
// impossible to recover afterward.
const developerLogLevel = process.env.LOG_LEVEL;

// Merely importing `@prisma/client` — never mind constructing one — reads the real `.env` off
// disk and copies it into `process.env`, unconditionally, as a side effect baked into the
// package itself. `src/lib/db.ts` documents the same fact at its own trigger site (construction,
// guarded there with a lazy Proxy instead); the two guard different moments this side effect can
// fire, so a Prisma upgrade that changes either needs both re-checked together. Every service
// module imports `Prisma` (for `Prisma.PrismaClientKnownRequestError`
// checks) or `PrismaClient`, so the moment a spec file's own imports reach one of them, whatever
// this file does below would quietly be undone — and by then it is too late: `config.ts` freezes
// its parsed snapshot the instant it is first imported, which for most spec files happens in the
// very same breath. Forcing that side effect to happen here, inside a `setupFiles` script that
// always runs before the spec file's own imports do, means Node's module cache already holds
// `@prisma/client` — fully evaluated, side effect and all — by the time the spec file imports it
// too, so that later import is a cache hit that runs no code and pollutes nothing a second time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('@prisma/client');

// Deleted unconditionally, even if a real key is sitting in .env for `npm run dev`'s benefit:
// anything that tries to construct a real client in this suite must fail loudly on a missing key,
// not succeed quietly because the project's own .env happened to have one.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

// Fixed, so any snapshot or id derived from the clock is stable across machines and runs.
process.env.TZ = 'UTC';

// Silent by default: an agent run logs a line per step, and several hundred of those interleaved
// with Jest's own reporter buries the failure that matters. A spec that is *about* logging sets
// its own level (see src/lib/observability/logger.spec.ts, which builds its own instance), and a
// developer chasing a run can still override this from their own environment — which is what
// `developerLogLevel` is: the value from before the `.env` file could have reached it, so a real
// `LOG_LEVEL=debug npm test` is honoured and the project's own `.env` default is not mistaken
// for one.
process.env.LOG_LEVEL = developerLogLevel ?? 'silent';

// Points at a throwaway file the suite never actually opens — every DB-touching spec uses its own
// disposable database via `createTestDb`, and this only stops the default client's constructor
// complaining about an unset datasource URL. Unconditional, not `??=`: the forced import above
// can just as easily have refilled this from `.env` with the real development database's path,
// and this must never be it, by accident or otherwise.
process.env.DATABASE_URL = 'file:./test.db';

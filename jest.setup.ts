/**
 * Runs before every Jest suite.
 *
 * The point is that the unit suite cannot reach a model provider even by accident. A test that
 * quietly succeeds because someone's key happened to be exported is not a test of this codebase,
 * and one that bills a real account for running `npm test` is worse. The orchestrator is driven by
 * a mock model in every Jest spec; anything that tries to construct a real client here should fail
 * loudly on a missing key rather than silently work on the author's machine.
 */

delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;

// Fixed, so any snapshot or id derived from the clock is stable across machines and runs.
process.env.TZ = 'UTC';

// Silent by default: an agent run logs a line per step, and several hundred of those interleaved
// with Jest's own reporter buries the failure that matters. A spec that is *about* logging sets
// its own level (see src/lib/observability/logger.spec.ts, which builds its own instance), and a
// developer chasing a run can still override this from the environment.
process.env.LOG_LEVEL ??= 'silent';

// Points at a throwaway file the suite never actually opens — Prisma is mocked in unit specs, and
// this only stops the client's constructor complaining about an unset datasource URL.
process.env.DATABASE_URL ??= 'file:./test.db';

import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client for the process, held on `globalThis` across Next's dev-server module
 * reloads. Without this, every hot reload creates a fresh client — and a fresh connection pool —
 * on top of the ones from every reload before it, which exhausts SQLite's file handles quickly.
 */
declare global {
  var __prismaClient: PrismaClient | undefined;
}

// Memoized in module scope, not only on `globalThis`, and unconditionally — not gated on
// `NODE_ENV` — because the Proxy below calls `getClient()` on every property access rather than
// once at module-eval time (which is what made the previous plain `const db = ... ?? new
// PrismaClient()` construct exactly once per process without needing this variable at all). A
// production module is never hot-reloaded, so it does not need `globalThis` to survive a reload,
// but it still evaluates this function on every request unless something in this file's own scope
// remembers the answer — the `NODE_ENV` check below governs only whether that answer is *also*
// written to `globalThis`, for dev's benefit; it must never gate whether it is remembered at all.
let cachedClient: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (cachedClient !== undefined) return cachedClient;
  cachedClient = globalThis.__prismaClient ?? new PrismaClient();
  if (process.env.NODE_ENV !== 'production') globalThis.__prismaClient = cachedClient;
  return cachedClient;
}

/**
 * Every service takes `client: PrismaClient = db` as its default — a real, typed `PrismaClient`,
 * not a factory function, so none of those call sites change. What changes is *when* the
 * constructor runs: behind this `Proxy`, only on first actual use, not on first import.
 *
 * That laziness is not a micro-optimisation. `new PrismaClient(...)` runs Prisma's own bundled
 * `.env` loader as a side effect, and that loader is not the well-behaved `dotenv` package's
 * "fill in what's missing" — it overwrites `process.env` from the real `.env` file
 * unconditionally, every time a client is constructed — the same fact `jest.setup.ts` documents
 * at its own trigger site (merely *importing* `@prisma/client`, before any constructor runs).
 * The two guard different moments the side effect can fire; a Prisma upgrade that changes when or
 * how it fires needs both re-checked together. Every service module does
 * `import { db } from '@/lib/db'` purely to name it as a default parameter value; before this,
 * merely importing one of them — never calling anything — reconstructed the real environment
 * from disk. A Jest run that depends on a variable staying deleted (`jest.setup.ts` deletes the
 * provider keys precisely so a run can never reach a real model by accident) could not tell
 * whether that held, because nothing in this project ever called `db` in a test: every test
 * passes its own disposable client explicitly. Behind this proxy, that means the constructor
 * underneath `db` simply never runs in the test suite at all — not patched around, not raced
 * against, just never reached.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getClient(), property, receiver);
  },
});

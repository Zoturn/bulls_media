/**
 * `db` must not construct a real `PrismaClient` merely by being imported — every service module
 * imports it purely to name it as a default parameter, and `new PrismaClient(...)` has a real,
 * unwanted side effect: it reloads `.env` into `process.env`, unconditionally, which is exactly
 * what broke `startRun`'s "no model configured" test before this file was made lazy. See the
 * comment on `db` in `./db.ts` for the full story.
 */

const construct = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    constructor() {
      construct();
    }
  },
}));

beforeEach(() => {
  jest.resetModules();
  construct.mockClear();
  delete globalThis.__prismaClient;
});

describe('db', () => {
  it('does not construct a client on import', async () => {
    await import('./db');
    expect(construct).not.toHaveBeenCalled();
  });

  it('constructs a client on first actual use, not before', async () => {
    const { db } = await import('./db');
    expect(construct).not.toHaveBeenCalled();

    void db.$disconnect;

    expect(construct).toHaveBeenCalledTimes(1);
  });

  it('reuses the same client for every property access', async () => {
    const { db } = await import('./db');
    void db.$disconnect;
    void db.$connect;
    void db.run;

    expect(construct).toHaveBeenCalledTimes(1);
  });

  it('reuses the same client under NODE_ENV=production, where globalThis caching is skipped', async () => {
    // Restored explicitly, not left to `restoreMocks` (this suite only sets `clearMocks`):
    // `NODE_ENV` is real process state shared by every test file a Jest worker runs next, and
    // leaking 'production' into them would be exactly the kind of environment pollution this
    // whole file exists to rule out.
    const replaced = jest.replaceProperty(process.env, 'NODE_ENV', 'production');
    try {
      const { db } = await import('./db');
      void db.$disconnect;
      void db.$connect;
      void db.run;

      // The regression this guards: a Proxy `get` trap runs on every access, so nothing but this
      // module's own memoization stands between "lazy" and "a fresh PrismaClient per access" once
      // the `NODE_ENV !== 'production'` branch that writes to `globalThis` is skipped.
      expect(construct).toHaveBeenCalledTimes(1);
    } finally {
      replaced.restore();
    }
  });
});

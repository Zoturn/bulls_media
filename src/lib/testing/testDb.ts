import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { getTemplateDbPath, removeDbFiles } from './testDbTemplate';

/**
 * A real, disposable, freshly-migrated SQLite database for a test file that needs one — anything
 * proving a schema constraint (cascade delete, a unique index) or a service's actual query, where
 * mocking Prisma would only prove the mock does what it was told. See
 * prisma/schema.spec.ts, which this factors out of, and .claude/rules/testing.md.
 *
 * Each call gets its own file (named by the caller plus the process id and a counter), so test
 * files running in separate Jest workers never collide on the same database.
 *
 * The migration itself runs exactly once for the whole test run, in jest.globalSetup.ts — which
 * executes once in Jest's main process before any worker starts, not once per worker. A
 * module-level flag here would only dedupe calls *within* one worker, and this project's suite
 * spreads 9+ DB-touching spec files across up to `os.cpus().length` workers, so without a step
 * that runs before workers exist at all, several of them would each still pay the ~1.15s
 * `prisma migrate deploy` cost for the identical template. `createTestDb` only ever copies that
 * already-migrated template — a sub-millisecond file operation — so isolation (each test file
 * gets its own physically separate file) costs nothing extra. See testDbTemplate.ts for why the
 * template's own path is scoped per run rather than fixed.
 */

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

let counter = 0;

export interface TestDb {
  prisma: PrismaClient;
  cleanup: () => Promise<void>;
}

/**
 * Returns a client pointed at a fresh copy of the migrated template, plus a `cleanup` that
 * disconnects and removes that copy and its SQLite sidecars.
 */
export function createTestDb(name: string): TestDb {
  const templatePath = getTemplateDbPath();
  if (!existsSync(templatePath)) {
    throw new Error(
      `createTestDb: no migrated template at ${templatePath}. ` +
        'jest.globalSetup.ts should have created it before any test ran — ' +
        'check that jest.config.js still points globalSetup at that file.',
    );
  }

  const dbPath = path.join(PROJECT_ROOT, 'prisma', `test-${name}-${process.pid}-${counter++}.db`);
  removeDbFiles(dbPath);
  copyFileSync(templatePath, dbPath);

  const prisma = new PrismaClient({ datasourceUrl: `file:${dbPath}` });

  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      removeDbFiles(dbPath);
    },
  };
}

import { execFileSync, type StdioOptions } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const PRISMA_BIN = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

/**
 * Where this test run's shared, migrated template database lives, and the cleanup helper for it
 * and its SQLite sidecars. Shared by jest.globalSetup.ts (creates it), jest.globalTeardown.ts
 * (removes it), and testDb.ts (copies it), so there is one definition of "where the template
 * lives" rather than three kept in sync by a comment.
 *
 * The path is scoped by `TEST_DB_TEMPLATE_RUN_ID` rather than a fixed literal. A fixed path
 * shared by every `npm test` invocation on the machine meant two concurrent runs — two
 * terminals, two CI jobs sharing a self-hosted runner — could collide: one run's globalTeardown
 * deleting the template while another run's workers were still mid-copy from it. On Windows
 * specifically that is not a benign race — the OS refuses to delete or replace a file another
 * process has open, so the failure is a hard, intermittent EBUSY/EPERM whose cause is invisible
 * from the stack trace. `jest.globalSetup.ts` sets this env var to its own `process.pid` — a
 * value already unique per run, needing no new id-generation logic — before any worker starts;
 * Jest workers inherit `process.env` set in globalSetup, which is the documented way to pass a
 * value from Jest's main process to its workers.
 */
export const TEST_DB_TEMPLATE_RUN_ID_ENV = 'TEST_DB_TEMPLATE_RUN_ID';

export function getTemplateDbPath(): string {
  const runId = process.env[TEST_DB_TEMPLATE_RUN_ID_ENV];
  if (!runId) {
    throw new Error(
      `getTemplateDbPath: ${TEST_DB_TEMPLATE_RUN_ID_ENV} is not set. jest.globalSetup.ts should ` +
        'have set it before any worker started — check jest.config.js still wires globalSetup.',
    );
  }
  return path.join(os.tmpdir(), `inbound-brief-desk-test-template-${runId}.db`);
}

export function removeDbFiles(dbPath: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

/**
 * Runs `prisma migrate deploy` against a fresh SQLite file at `dbPath`. Has nothing Jest-specific
 * about it — unlike `getTemplateDbPath`, it needs no run-scoped env var — so both
 * `jest.globalSetup.ts` (building the shared test template) and `scripts/generate-examples.ts`
 * (building its own disposable database) call this rather than each invoking `prisma` themselves.
 */
export function migrateSqliteDatabase(dbPath: string, stdio: StdioOptions = 'pipe'): void {
  execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio,
    shell: true,
  });
}

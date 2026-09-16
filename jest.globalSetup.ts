/**
 * Runs once, in Jest's main process, before any worker starts — not once per worker. This is
 * what makes the "migrate the test-database template once" optimisation in
 * src/lib/testing/testDb.ts actually work: a module-level flag there only dedupes calls within
 * one worker process, and Jest schedules test files across several workers by default (this
 * project's suite has 9+ DB-touching spec files, easily more than the CPU count), so without a
 * step that runs before workers exist at all, several workers would each pay the ~1.15s
 * `prisma migrate deploy` cost for the same, identical template.
 *
 * See src/lib/testing/testDbTemplate.ts for why the template's path is scoped by a run id set
 * here, rather than a fixed literal every `npm test` invocation on the machine would share.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  getTemplateDbPath,
  removeDbFiles,
  TEST_DB_TEMPLATE_RUN_ID_ENV,
} from './src/lib/testing/testDbTemplate';

const PROJECT_ROOT = __dirname;
const PRISMA_BIN = path.join(
  PROJECT_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

export default async function globalSetup(): Promise<void> {
  // Jest inherits process.env mutations made here into every worker it spawns afterward — the
  // documented way to pass a value from this main process down to them.
  process.env[TEST_DB_TEMPLATE_RUN_ID_ENV] = String(process.pid);

  const templatePath = getTemplateDbPath();
  removeDbFiles(templatePath);

  execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: `file:${templatePath}` },
    stdio: 'pipe',
    shell: true,
  });
}

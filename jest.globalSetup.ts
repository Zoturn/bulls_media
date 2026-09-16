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
import {
  getTemplateDbPath,
  migrateSqliteDatabase,
  removeDbFiles,
  TEST_DB_TEMPLATE_RUN_ID_ENV,
} from './src/lib/testing/testDbTemplate';

export default async function globalSetup(): Promise<void> {
  // Jest inherits process.env mutations made here into every worker it spawns afterward — the
  // documented way to pass a value from this main process down to them.
  process.env[TEST_DB_TEMPLATE_RUN_ID_ENV] = String(process.pid);

  const templatePath = getTemplateDbPath();
  removeDbFiles(templatePath);
  migrateSqliteDatabase(templatePath);
}

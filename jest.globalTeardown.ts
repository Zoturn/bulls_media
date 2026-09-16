/**
 * Removes the shared template database jest.globalSetup.ts created, once the whole run — every
 * worker — has finished with it. Good hygiene rather than a correctness requirement: the OS temp
 * directory would reclaim it eventually regardless.
 */
import { getTemplateDbPath, removeDbFiles } from './src/lib/testing/testDbTemplate';

export default async function globalTeardown(): Promise<void> {
  removeDbFiles(getTemplateDbPath());
}

import type { PrismaClient } from '@prisma/client';
import type { LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { getCaseForRun } from '@/lib/services/cases';
import { findActiveRunForCase } from '@/lib/services/runs';
import { executeRun } from './run';

/**
 * The one entry point the console needs: start a run and learn its id without waiting for it to
 * finish. See openspec/changes/add-operator-console/design.md — `executeRun`'s `onRunStarted`
 * hook is what makes the second half possible without this module re-deriving run creation.
 */

export interface StartRunDeps {
  /** Defaults to `anthropic(config.AGENT_MODEL)`. Tests supply a scripted model instead. */
  model?: LanguageModel;
  client?: PrismaClient;
}

export type StartRunResult =
  | { ok: true; runId: string }
  | { ok: false; reason: 'CASE_NOT_FOUND' }
  | { ok: false; reason: 'RUN_IN_PROGRESS'; runId: string }
  | { ok: false; reason: 'MODEL_NOT_CONFIGURED' };

export async function startRun(caseId: string, deps: StartRunDeps = {}): Promise<StartRunResult> {
  const client = deps.client ?? db;

  const subject = await getCaseForRun(caseId, client);
  if (subject === null) return { ok: false, reason: 'CASE_NOT_FOUND' };

  // Checked before the model: `findActiveRunForCase` is a fast local read, and there is no reason
  // to ask "is a model configured" for a request that a concurrency check is about to refuse.
  const active = await findActiveRunForCase(caseId, client);
  if (active !== null) return { ok: false, reason: 'RUN_IN_PROGRESS', runId: active.id };

  // The check is skipped when a caller supplies its own model (every test does): that caller does
  // not need a real key, and asking for one would make the model-not-configured path untestable
  // without one.
  if (deps.model === undefined && config.ANTHROPIC_API_KEY === undefined) {
    return { ok: false, reason: 'MODEL_NOT_CONFIGURED' };
  }
  const model = deps.model ?? anthropic(config.AGENT_MODEL);

  return new Promise((resolve, reject) => {
    let started = false;
    executeRun(caseId, {
      model,
      client,
      caseForRun: subject,
      onRunStarted: (runId) => {
        started = true;
        resolve({ ok: true, runId });
      },
    })
      .then((result) => {
        // Belt and braces, not the expected path: `onRunStarted` fires before every return in
        // `executeRun` today, so this only matters if that contract is ever broken by a future
        // change to the loop — this is what keeps that a slow HTTP response instead of one that
        // never resolves at all.
        if (!started) resolve({ ok: true, runId: result.runId });
      })
      .catch((error: unknown) => {
        // executeRun's own contract is to never throw — every path it can reach closes the run and
        // returns a result instead. A rejection here means it failed before `onRunStarted` ever
        // fired (createRun itself failed, say), which is the one outcome this promise has not yet
        // settled for; anything after the run started is already recorded on the run itself.
        if (!started) reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

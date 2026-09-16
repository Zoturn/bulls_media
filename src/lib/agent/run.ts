import type { PrismaClient } from '@prisma/client';
import type { LanguageModel, StepResult, ToolSet } from 'ai';
import { generateText, isStepCount, Output } from 'ai';
import { config } from '@/lib/config';
import { db } from '@/lib/db';
import { forRun } from '@/lib/observability/logger';
import type { TerminalRunStatus } from '@/lib/domain/enums';
import { getCaseForRun } from '@/lib/services/cases';
import { closeRun, createRun, recordStep, type RecordStepInput } from '@/lib/services/runs';
import { claimFromAssessment } from '@/lib/guardrails/claims';
import {
  checkPostConditions,
  describeViolations,
  type PostConditionViolation,
} from '@/lib/guardrails/postconditions';
import { describeRefusal, enforcedStatusFor, refusalEvidence } from '@/lib/guardrails/refusal';
import { assessmentSchema, type Assessment } from './assessment';
import { activeToolsFor, phaseFor, type AgentPhase, type RecordedToolResult } from './phases';
import { PROMPT_VERSION, renderUntrusted, SYSTEM_PROMPT } from './prompt';
import { buildRunTools } from './tools';

/**
 * The run loop.
 *
 * One `generateText` call, bounded twice — by a step count and by a wall clock — with
 * `prepareStep` narrowing the tools to the current phase before every step. The phase comes from
 * `phaseFor`, a pure function of the tool results recorded so far, so what the model may do next
 * is decided by what has actually happened rather than by anything the model or the inbound email
 * asserts. See this change's design.md for why this is one call rather than one per phase.
 *
 * Nothing here reaches a provider by itself: `deps.model` is always supplied by the caller, and
 * every test supplies `MockLanguageModelV4`.
 */

export interface ExecuteRunDeps {
  model: LanguageModel;
  /** Recorded on the run. Defaults to the configured model id. */
  modelId?: string;
  client?: PrismaClient;
  maxSteps?: number;
  timeoutMs?: number;
}

export interface ExecuteRunResult {
  runId: string;
  status: TerminalRunStatus;
  /** Present only when the model produced a schema-valid structured answer. */
  assessment?: Assessment;
  /** Present only when the run failed; the reason, in the same words recorded on the run. */
  error?: string;
  /** Every post-condition the structured answer failed. Empty on a run whose claims held up. */
  violations: PostConditionViolation[];
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * JSON for a trace column. A tool input or output that will not serialise is a defect in the
 * tool, but it must not be one that takes the whole trace down with it.
 */
function toJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch (error) {
    return JSON.stringify({ unserialisable: errorMessageOf(error) });
  }
}

export async function executeRun(caseId: string, deps: ExecuteRunDeps): Promise<ExecuteRunResult> {
  const client = deps.client ?? db;
  const maxSteps = deps.maxSteps ?? config.AGENT_MAX_STEPS;
  const timeoutMs = deps.timeoutMs ?? config.AGENT_TIMEOUT_MS;
  // The model that actually ran, not the one configuration names — the caller supplies the model,
  // and a trace that records a model id the run did not use cannot explain a regression.
  const modelId =
    deps.modelId ?? (typeof deps.model === 'string' ? deps.model : deps.model.modelId);

  const subject = await getCaseForRun(caseId, client);
  if (subject === null) throw new Error(`executeRun: no case ${caseId}`);

  const { id: runId } = await createRun(
    { caseId, modelId, promptVersion: PROMPT_VERSION, maxSteps },
    client,
  );
  const log = forRun(runId, caseId);

  // The phase input. Appended to synchronously inside onStepEnd — before any await — so that
  // `prepareStep` reads a history that is current whether or not the SDK awaits the callback.
  const history: RecordedToolResult[] = [];
  let stepIndex = 0;
  let lastPhase: AgentPhase = 'TRIAGE';

  // Step writes are serialised through one chain and awaited before the run closes, so two step
  // rows can never race for the same index and a run cannot finish with a write still in flight.
  //
  // Each link swallows its own rejection into `writeFailure` rather than propagating. That is not
  // squeamishness: `writes` is awaited outside the try/catch below, so a rejected chain would
  // throw out of `executeRun` past everything that closes the run — leaving it RUNNING for ever,
  // which is the one outcome this function is not allowed to produce. Recording the failure and
  // ending the run FAILED says the same thing, and says it where an operator can see it.
  let writes: Promise<unknown> = Promise.resolve();
  let writeFailure: string | undefined;
  const write = (step: Omit<RecordStepInput, 'runId' | 'index'>): number => {
    const index = stepIndex++;
    writes = writes
      .then(() => recordStep({ ...step, runId, index }, client))
      .catch((error: unknown) => {
        writeFailure ??= `Failed to record step ${index}: ${errorMessageOf(error)}`;
        log.error({ step: index, type: step.type }, 'failed to record run step');
      });
    return index;
  };

  const recordModelStep = (step: StepResult<ToolSet>): number => {
    const toolMs = Object.values(step.performance.toolExecutionMs).reduce((a, b) => a + b, 0);
    return write({
      type: 'MODEL_CALL',
      output: toJson({
        phase: lastPhase,
        text: step.text,
        toolCalls: step.toolCalls.map((call) => call.toolName),
        finishReason: step.finishReason,
      }),
      // The model's own time: the step minus the tools it waited on.
      durationMs: Math.max(0, Math.round(step.performance.stepTimeMs - toolMs)),
      tokens: step.usage.totalTokens,
    });
  };

  const recordToolSteps = (step: StepResult<ToolSet>): void => {
    for (const result of step.toolResults) {
      write({
        type: 'TOOL_CALL',
        toolName: result.toolName,
        input: toJson(result.input),
        output: toJson(result.output),
        durationMs: Math.round(step.performance.toolExecutionMs[result.toolCallId] ?? 0),
      });
      history.push({ toolName: result.toolName, input: result.input, output: result.output });
    }

    // A call the phase allowlist refused never produces a result — it surfaces here, as a content
    // part. Recording it is the point: "the agent tried to price before checking policy" is the
    // single most useful line a reviewer can find in a trace, and dropping it hides exactly the
    // behaviour the allowlist exists to catch.
    for (const part of step.content) {
      if (part.type !== 'tool-error') continue;
      const index = write({
        type: 'TOOL_CALL',
        toolName: part.toolName,
        input: toJson(part.input),
        error: errorMessageOf(part.error),
        durationMs: Math.round(step.performance.toolExecutionMs[part.toolCallId] ?? 0),
      });
      log.warn({ step: index, tool: part.toolName }, 'tool call rejected');
    }
  };

  let status: TerminalRunStatus = 'FAILED';
  let assessment: Assessment | undefined;
  let failure: string | undefined;
  let totalTokens: number | undefined;
  let violations: PostConditionViolation[] = [];

  try {
    const result = await generateText({
      model: deps.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: renderUntrusted(subject.inboundMessage) }],
      tools: buildRunTools(runId, () => history, client),
      temperature: 0,
      stopWhen: isStepCount(maxSteps),
      timeout: { totalMs: timeoutMs },
      // No `maxRetries`: the SDK's own default is what this wants, and restating it would create a
      // knob whose only effect is to reproduce the behaviour it already has. Retrying transient
      // provider failures is the SDK's job; the orchestrator adds no retry of its own, because the
      // failures it can see — a refusal, a schema rejection — are deterministic
      // (.claude/rules/agent-orchestration.md rule 11).
      output: Output.object({ schema: assessmentSchema }),
      prepareStep: () => {
        lastPhase = phaseFor(history);
        return { activeTools: activeToolsFor(lastPhase) };
      },
      onStepEnd: (step) => {
        const index = recordModelStep(step);
        recordToolSteps(step);
        log.info(
          { step: index, phase: lastPhase, tokens: step.usage.totalTokens },
          'model step completed',
        );
      },
    });

    totalTokens = result.totalUsage.totalTokens;

    try {
      // Only `result.output` is guarded here: its getter is what throws when the model produced
      // no parseable answer, and the handler below is written for exactly that. Checking the
      // post-conditions inside this block too would let an unrelated throw be reported as
      // "no valid structured result", which is not what happened.
      assessment = result.output;
    } catch (error) {
      // `output` throws when the model never produced a parseable structured answer. Whether that
      // is "it ran out of room" or "it answered in prose" changes what a reviewer should do next,
      // so the two are distinguished here rather than both recorded as a parse failure.
      failure =
        result.steps.length >= maxSteps
          ? `Step budget exhausted after ${result.steps.length} model calls with no structured result`
          : `No valid structured result: ${errorMessageOf(error)}`;
    }
  } catch (error) {
    failure = errorMessageOf(error);
  }

  // Checked out here rather than beside the parse: a contradicted answer is not a parse failure,
  // and reporting it as one would send a reviewer looking in the wrong place.
  if (assessment !== undefined) {
    violations = checkPostConditions(claimFromAssessment(assessment), history);
    if (violations.length > 0) failure = describeViolations(violations);
  }

  // Every path lands here, including a thrown tool. The status is settled in one place, in a
  // fixed order of precedence, so there is one answer to "why is this run in this state":
  //
  //   1. the trace could not be written  → FAILED   (nothing here can be vouched for)
  //   2. policy refused                  → REFUSED  (rule 4: code decides, not the model)
  //   3. anything went wrong             → FAILED   (rule 7: fail closed)
  //   4. otherwise                       → whatever the disposition maps to
  //
  // 2 sits above 3 deliberately. A refused enquiry whose model then burned its step budget has
  // still been refused; closing it FAILED would present a settled policy decision as an
  // infrastructure problem for somebody to retry. The failure is not lost — it stays in
  // `errorMessage` and in the terminal step alongside the refusal.
  //
  // The guard below tests the *evidence*, not the resulting status. Those differ: a model can
  // claim `REFUSED` with nothing on record backing it, and `enforcedStatusFor` maps that claim to
  // `REFUSED` too. Testing the status would let a model-authored refusal skip the fail-closed
  // step and record a violated run as though policy had settled it.
  const refusal = refusalEvidence(history);
  status = enforcedStatusFor(history, assessment?.outcome.disposition);
  if (refusal === undefined && failure !== undefined) status = 'FAILED';

  // Drained here so a trace that failed to record is known about before the run is closed.
  await writes;

  // The terminal row is what an operator reads first, so it carries the evidence rather than a
  // bare status: which checks failed, and — when the run was refused — which rule refused it and
  // about what (.claude/rules/guardrails-and-injection.md rule 10; an unexplained refusal gets
  // overridden by the first person in a hurry).
  write({
    type: 'TERMINAL',
    output: toJson({
      status,
      phase: lastPhase,
      ...(assessment !== undefined && { disposition: assessment.outcome.disposition }),
      ...(refusal !== undefined && { refusal, refusalSummary: describeRefusal(refusal) }),
      ...(violations.length > 0 && { violations }),
    }),
    error: failure,
    durationMs: 0,
  });
  await writes;

  // Checked after the terminal row, not before it: a run whose trace is incomplete cannot be
  // vouched for, and the terminal row is the one an operator reads first — so its own failure to
  // write has to count too. `failure` is appended to rather than defaulted into, because a run
  // can both violate a post-condition and lose its trace, and an operator reading only the
  // violations would open a trace with a step silently missing from it.
  if (writeFailure !== undefined) {
    status = 'FAILED';
    failure = failure === undefined ? writeFailure : `${failure}; ${writeFailure}`;
  }

  const closed = await closeRun({ runId, status, totalTokens, errorMessage: failure }, client);
  if (!closed.ok) {
    log.warn({ status: closed.status }, 'run was already closed; terminal status not applied');
  }
  log.info({ status, totalTokens }, 'run finished');

  return { runId, status, assessment, error: failure, violations };
}

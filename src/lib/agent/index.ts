/**
 * The agent's public surface. `add-operator-console` imports from here, not from the modules
 * below, so the run loop's internals stay free to move.
 */

export { executeRun, type ExecuteRunDeps, type ExecuteRunResult } from './run';
export {
  assessmentSchema,
  dispositionToRunStatus,
  type Assessment,
  type AssessmentOutcome,
  type ExtractedBrief,
} from './assessment';
export { AGENT_PHASES, activeToolsFor, phaseFor, type AgentPhase } from './phases';
export { PROMPT_VERSION } from './prompt';

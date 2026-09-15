import { z } from 'zod';

/**
 * The value spaces for every status-like column in prisma/schema.prisma. SQLite has no native
 * enum type, so those columns are `String` with a comment naming the allowed values — this module
 * is where that comment becomes an enforceable type instead of prose a typo can silently violate.
 * See .claude/rules/typescript.md rule 3 and .claude/rules/data-model.md rule 1.
 *
 * No orchestrator or tool code reads these yet — this change only establishes the schema — but
 * the value spaces are fixed here now, in the same change that fixes the columns, rather than
 * left for whichever later change happens to write the first row to invent its own.
 */

export const CASE_STATUSES = ['OPEN', 'RESOLVED'] as const;
export const caseStatusSchema = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

export const RUN_STATUSES = ['RUNNING', 'COMPLETED', 'REFUSED', 'NEEDS_HUMAN', 'FAILED'] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const RUN_STEP_TYPES = ['MODEL_CALL', 'TOOL_CALL', 'TERMINAL'] as const;
export const runStepTypeSchema = z.enum(RUN_STEP_TYPES);
export type RunStepType = z.infer<typeof runStepTypeSchema>;

export const ASSESSMENT_DISPOSITIONS = [
  'QUOTED',
  'REFUSED',
  'NEEDS_INFO',
  'NOT_A_BRIEF',
  'NEEDS_REVIEW',
] as const;
export const assessmentDispositionSchema = z.enum(ASSESSMENT_DISPOSITIONS);
export type AssessmentDisposition = z.infer<typeof assessmentDispositionSchema>;

export const APPROVAL_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const POLICY_DECISIONS = ['ALLOW', 'REVIEW', 'REFUSE'] as const;
export const policyDecisionSchema = z.enum(POLICY_DECISIONS);
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export const RATE_CARD_CHANNELS = ['display', 'video', 'audio', 'newsletter'] as const;
export const rateCardChannelSchema = z.enum(RATE_CARD_CHANNELS);
export type RateCardChannel = z.infer<typeof rateCardChannelSchema>;

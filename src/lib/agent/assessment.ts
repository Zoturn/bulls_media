import { z } from 'zod';
import {
  rateCardChannelSchema,
  type AssessmentDisposition,
  type TerminalRunStatus,
} from '@/lib/domain/enums';
import { pricedLineItemSchema } from '@/lib/tools/calculateQuote';

/**
 * The shape of a finished run's answer, and the one place a disposition becomes a run status.
 *
 * This schema is handed to `Output.object`, so it is simultaneously what the model is asked to
 * produce, what the orchestrator validates, and the TypeScript type the console will later read —
 * one description, not three that drift (.claude/rules/typescript.md rule 3).
 *
 * The root is a plain object with the variable part nested under `outcome`, rather than a
 * top-level union. That is not stylistic: Anthropic's structured-output schema must have
 * `"type": "object"` at its root, so a root-level `anyOf` — which is what a top-level
 * `discriminatedUnion` compiles to — would be rejected by the provider. Nested, the union is an
 * ordinary subschema and the discrimination still holds at the type level.
 */

export const extractedBriefSchema = z.object({
  advertiser: z.string().min(1).max(200).describe('The advertiser or agency the email is from.'),
  vertical: z
    .string()
    .min(1)
    .max(100)
    .describe('The industry category, as passed to check_ad_policy.'),
  channel: rateCardChannelSchema.nullable().describe('Null when the email does not say.'),
  budgetCents: z.number().int().nonnegative().nullable().describe('Null when not stated.'),
  requestedVolume: z.number().int().positive().nullable().describe('Null when not stated.'),
  flightDays: z.number().int().positive().nullable().describe('Null when not stated.'),
});
export type ExtractedBrief = z.infer<typeof extractedBriefSchema>;

// Picked from `calculate_quote`'s own output rather than restated: the agent copies these numbers
// out of a tool result, so the tool owns their shape, and a change there should break this.
const quotedLineItemSchema = pricedLineItemSchema.pick({
  packageId: true,
  requestedVolume: true,
  totalCents: true,
});

const quoteSchema = z.object({
  lineItems: z.array(quotedLineItemSchema).min(1),
  totalCents: z
    .number()
    .int()
    .nonnegative()
    .describe('Copied verbatim from calculate_quote. Never computed here.'),
});

/**
 * One variant per disposition. Each carries exactly the fields its disposition can have, so a
 * refused outcome cannot type-check with a quote attached and a quoted one cannot type-check
 * without a total (.claude/rules/typescript.md rule 5).
 */
export const outcomeSchema = z.discriminatedUnion('disposition', [
  z.object({
    disposition: z.literal('QUOTED'),
    brief: extractedBriefSchema,
    quote: quoteSchema,
    draftReply: z.string().min(1).describe('The reply a salesperson would send, unsent.'),
  }),
  z.object({
    disposition: z.literal('REFUSED'),
    brief: extractedBriefSchema.nullable(),
    refusalReason: z.string().min(1).describe('Why check_ad_policy refused, in plain language.'),
  }),
  z.object({
    disposition: z.literal('NEEDS_INFO'),
    brief: extractedBriefSchema,
    missingFields: z.array(z.string().min(1)).min(1),
    draftReply: z.string().min(1).describe('A reply asking for exactly the missing fields.'),
  }),
  z.object({
    disposition: z.literal('NEEDS_REVIEW'),
    brief: extractedBriefSchema,
    reviewReason: z.string().min(1).describe('Why a human has to look at this before it goes out.'),
  }),
  z.object({
    disposition: z.literal('NOT_A_BRIEF'),
  }),
]);
export type AssessmentOutcome = z.infer<typeof outcomeSchema>;

export const assessmentSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(2000)
    .describe('One or two sentences: what came in, what was decided, and why.'),
  outcome: outcomeSchema,
});
export type Assessment = z.infer<typeof assessmentSchema>;

/**
 * The only mapping from what the agent decided to what the run is recorded as. Exhaustive by
 * construction: the `never` in the default branch means adding a disposition fails to compile
 * here until somebody decides what it means for the run.
 *
 * The parameter is the domain's `AssessmentDisposition`, not `AssessmentOutcome['disposition']`.
 * Those are the same set today, and typing it against the domain is what keeps them that way —
 * a disposition added to `enums.ts` but not given a variant above breaks this switch, where the
 * narrower type would have let the two drift apart silently.
 */
export function dispositionToRunStatus(disposition: AssessmentDisposition): TerminalRunStatus {
  switch (disposition) {
    case 'REFUSED':
      return 'REFUSED';
    case 'NEEDS_REVIEW':
      return 'NEEDS_HUMAN';
    case 'QUOTED':
    case 'NEEDS_INFO':
    case 'NOT_A_BRIEF':
      return 'COMPLETED';
    default: {
      const unhandled: never = disposition;
      throw new Error(`No run status defined for disposition ${String(unhandled)}`);
    }
  }
}

// There are deliberately no `quoteCentsOf` / `refusalReasonOf` / `draftReplyOf` helpers here.
// Nothing in this change persists the assessment from the structured answer: the model writes the
// `Assessment` row itself, through `save_case`. Accessors "for `Assessment.quoteCents`" with no
// caller on the save path would read as though that were not true. If `add-agent-guardrails`
// needs them for its post-conditions, they are one ternary each.

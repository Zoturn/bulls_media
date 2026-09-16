import { z } from 'zod';

/**
 * The discriminated result shape every tool returns, per .claude/rules/agent-tools.md rule 7:
 * `{ ok: true, data }` or `{ ok: false, reason }`. Factored into one place so the five tools'
 * output schemas declare this envelope once each, not as five (and, for the failure variants,
 * more) independently hand-written `z.object`s that have to be kept in agreement by eye.
 */

export function okSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({ ok: z.literal(true), data: dataSchema });
}

export function failSchema<Reason extends string>(reason: Reason) {
  return z.object({ ok: z.literal(false), reason: z.literal(reason) });
}

/** The one shape every "no such package" failure takes, shared by lookup_inventory and calculate_quote. */
export const packageNotFoundSchema = failSchema('PACKAGE_NOT_FOUND').extend({
  packageId: z.string(),
});

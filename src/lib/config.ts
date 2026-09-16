import { z } from 'zod';

/**
 * Parsed once, at module load, from `process.env`. A missing or malformed required setting fails
 * here — at import time — rather than surfacing later as a `NaN` step budget or an unexplained
 * runtime error partway through an agent run.
 *
 * `ANTHROPIC_API_KEY` is validated when present but not required: the console and the whole Jest
 * suite must be able to start with no key at all (jest.setup.ts deletes it explicitly), and a run
 * attempted without one fails with a clear configuration error at the point of the run, which is
 * where it is actionable.
 */

// `z.coerce.number()` on `undefined` fails as NaN, but chaining `.optional()` after it short-
// circuits before coercion runs — an absent env var reaches `.default()` untouched, while a
// present-but-non-numeric one is still rejected by the coercion. No custom transform needed: the
// field name in every error message below comes from `loadConfig`'s own path-based prefix, not
// from repeating it in the check.
const positiveIntFromEnv = () => z.coerce.number().int().positive().optional();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AGENT_MODEL: z.string().min(1).default('claude-sonnet-5'),
  AGENT_MAX_STEPS: positiveIntFromEnv().default(12),
  AGENT_TIMEOUT_MS: positiveIntFromEnv().default(120_000),
  // The value space is Pino's own set of levels, 'silent' included — this schema describes what
  // the variable may legally hold, not what any particular deployment should choose. The Jest
  // suite happens to be the first caller to want silence (jest.setup.ts), but a one-off script or
  // a CLI invocation wants the same thing, and neither is a reason for the logger to know it is
  // under test.
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return Object.freeze(result.data);
}

export type AppConfig = z.infer<typeof envSchema>;

export const config: AppConfig = loadConfig();

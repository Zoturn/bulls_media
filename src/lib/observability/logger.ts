import pino from 'pino';
import { config } from '@/lib/config';

/**
 * Structured logging via Pino. Redaction is configured here rather than left to call-site
 * discipline: an inbound message body or a credential is redacted before it can reach a log
 * sink, regardless of which field name a future call site happens to use.
 *
 * See .claude/rules/observability.md and .claude/rules/guardrails-and-injection.md — logs travel
 * further than the data they describe, and advertiser correspondence is not something every
 * downstream log aggregator should see.
 */

// Pino's `*.field` wildcard already matches `field` nested under ANY single parent key — so
// `*.body` alone covers `message.body`, `inboundMessage.body`, or any other object's `.body`,
// with no need to enumerate each shape separately (verified: a redact test against `*.body` alone
// redacts both `{ message: { body } }` and `{ inboundMessage: { body } }`). What the wildcard does
// NOT reach is the bare top-level field — `*.field` does not match `field` at the object's own
// root — so each field is listed exactly twice: once bare, once wildcarded, never per-shape.
export const REDACTED_PATHS = [
  // Inbound message content, wherever it appears in a logged object.
  'body',
  '*.body',
  // Drafted replies — also commercial correspondence, not yet sent.
  'draftReply',
  '*.draftReply',
  // Credential-bearing fields, however they get logged.
  'apiKey',
  '*.apiKey',
  'ANTHROPIC_API_KEY',
  '*.ANTHROPIC_API_KEY',
  'authorization',
  '*.authorization',
];

// pino-pretty runs on a worker thread, spun up as soon as the transport is attached. That thread
// is a handle Jest never sees closed, so it must not attach under a Jest worker — only in an
// actual `next dev` process is a human there to benefit from colourised output. Gated on
// JEST_WORKER_ID rather than NODE_ENV === 'test': the latter is a deployment-environment name
// anyone could set for an unrelated reason, where this one is set only by Jest itself.
const usePrettyTransport =
  process.env.NODE_ENV !== 'production' && process.env.JEST_WORKER_ID === undefined;

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[redacted]',
  },
  transport: usePrettyTransport
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
});

/**
 * Binds `runId` and `caseId` onto every line a call site logs, so correlating a run's activity is
 * the default rather than something each call site has to remember to pass.
 */
export function forRun(runId: string, caseId: string) {
  return logger.child({ runId, caseId });
}

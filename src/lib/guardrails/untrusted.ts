/**
 * Everything that reaches the model from outside the system prompt passes through here.
 *
 * This lives in `guardrails/` rather than in `agent/prompt.ts` because it is not only the inbound
 * email's problem. A rate-card row is a document, and the retrieval path exists precisely to turn
 * documents into model input — so "we seeded it ourselves" is a statement about today's corpus, not
 * a property of the path. See .claude/rules/guardrails-and-injection.md rules 2 and 6.
 */

const OPEN_DELIMITER = '<<<UNTRUSTED_INBOUND_MESSAGE>>>';
const CLOSE_DELIMITER = '<<<END_UNTRUSTED_INBOUND_MESSAGE>>>';

/** Exported so specs assert against the delimiters rather than restating them. */
export const UNTRUSTED_DELIMITERS = {
  open: OPEN_DELIMITER,
  close: CLOSE_DELIMITER,
} as const;

/**
 * Anything shaped like one of this module's delimiters. Matching the *shape* rather than the two
 * exact tokens costs nothing and means adding a delimiter later cannot silently reopen the hole.
 * `[^\n>]` keeps a match from spanning a line or swallowing an unrelated `>`, which also bounds
 * what a crafted string can make this regex do.
 */
const DELIMITER_SHAPED = /<<<[^\n>]{0,64}>>>/g;

/**
 * Removes delimiter-shaped tokens from untrusted text, so it cannot end the untrusted block early
 * and continue as though it were the operator talking.
 */
export function neutralise(text: string): string {
  return text.replace(DELIMITER_SHAPED, '[delimiter removed]');
}

export interface UntrustedMessage {
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
}

/**
 * The inbound message as a user message: delimited, labelled, and with every field neutralised —
 * the sender's display name and the subject line are attacker-controlled too, not just the body.
 */
export function renderUntrusted(message: UntrustedMessage): string {
  return [
    OPEN_DELIMITER,
    `From: ${neutralise(message.fromName)} <${neutralise(message.fromAddress)}>`,
    `Subject: ${neutralise(message.subject)}`,
    '',
    neutralise(message.body),
    CLOSE_DELIMITER,
  ].join('\n');
}

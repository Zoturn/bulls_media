import { Writable } from 'node:stream';
import pino from 'pino';
import { REDACTED_PATHS } from './logger';

/**
 * The shared `logger` singleton reads `config.LOG_LEVEL` at module load and, outside production,
 * always attaches the `pino-pretty` transport — which writes to a worker thread, not to a stream
 * this test can capture synchronously. Redaction itself is configuration, not the transport, so
 * it is verified here against a second pino instance built with the same exported `REDACTED_PATHS`
 * and a plain writable destination, which is the standard way to assert on Pino output.
 */

function captureLog(logFn: (log: pino.Logger) => void): Record<string, unknown> {
  let captured = '';
  const destination = new Writable({
    write(chunk, _enc, callback) {
      captured += chunk.toString();
      callback();
    },
  });

  const log = pino(
    { level: 'info', redact: { paths: REDACTED_PATHS, censor: '[redacted]' } },
    destination,
  );
  logFn(log);

  return JSON.parse(captured) as Record<string, unknown>;
}

describe('logger redaction', () => {
  it('redacts a nested inbound message body at info level', () => {
    const line = captureLog((log) =>
      log.info({ message: { id: 'msg-1', body: 'sensitive advertiser text' } }, 'received'),
    );

    expect((line.message as Record<string, unknown>).body).toBe('[redacted]');
  });

  it('redacts a top-level body field at info level', () => {
    const line = captureLog((log) => log.info({ body: 'sensitive advertiser text' }, 'received'));

    expect(line.body).toBe('[redacted]');
  });

  it('redacts a top-level credential field at info level', () => {
    const line = captureLog((log) => log.info({ apiKey: 'sk-ant-super-secret' }, 'config loaded'));

    expect(line.apiKey).toBe('[redacted]');
  });

  it('redacts a nested credential field at info level', () => {
    const line = captureLog((log) =>
      log.info({ headers: { authorization: 'Bearer sk-ant-super-secret' } }, 'request sent'),
    );

    expect((line.headers as Record<string, unknown>).authorization).toBe('[redacted]');
  });

  it('redacts a drafted reply', () => {
    const line = captureLog((log) =>
      log.info({ assessment: { draftReply: 'Dear advertiser, here is our quote...' } }, 'assessed'),
    );

    expect((line.assessment as Record<string, unknown>).draftReply).toBe('[redacted]');
  });

  it('does not redact unrelated fields', () => {
    const line = captureLog((log) =>
      log.info({ runId: 'run-1', tool: 'search_rate_card' }, 'tool call'),
    );

    expect(line.runId).toBe('run-1');
    expect(line.tool).toBe('search_rate_card');
  });
});

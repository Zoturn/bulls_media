import { readFileSync } from 'node:fs';
import path from 'node:path';

const ORIGINAL_ENV = { ...process.env };

/**
 * `config.ts` parses `process.env` at module load, so each test needs a fresh module registry
 * with `process.env` set up beforehand — re-requiring the cached module would just return the
 * first parse.
 */
function loadConfigWith(env: Record<string, string | undefined>) {
  jest.resetModules();
  // NODE_ENV is carried over rather than replaced: Next's own type augmentation requires it on
  // NodeJS.ProcessEnv, and this helper's whole point is testing config.ts's own parsing, not
  // NODE_ENV's.
  process.env = { ...ORIGINAL_ENV, ...env };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./config') as typeof import('./config');
}

describe('config', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('parses a valid environment', () => {
    const { config } = loadConfigWith({
      DATABASE_URL: 'file:./dev.db',
      AGENT_MAX_STEPS: '12',
      AGENT_TIMEOUT_MS: '120000',
      LOG_LEVEL: 'info',
    });

    expect(config.DATABASE_URL).toBe('file:./dev.db');
    expect(config.AGENT_MAX_STEPS).toBe(12);
    expect(config.AGENT_TIMEOUT_MS).toBe(120_000);
  });

  it('rejects a missing DATABASE_URL, naming it', () => {
    expect(() => loadConfigWith({ DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-integer AGENT_MAX_STEPS', () => {
    expect(() =>
      loadConfigWith({ DATABASE_URL: 'file:./dev.db', AGENT_MAX_STEPS: 'twelve' }),
    ).toThrow(/AGENT_MAX_STEPS/);
  });

  it('rejects a negative AGENT_MAX_STEPS', () => {
    expect(() => loadConfigWith({ DATABASE_URL: 'file:./dev.db', AGENT_MAX_STEPS: '-1' })).toThrow(
      /AGENT_MAX_STEPS/,
    );
  });

  it('rejects a zero AGENT_MAX_STEPS', () => {
    expect(() => loadConfigWith({ DATABASE_URL: 'file:./dev.db', AGENT_MAX_STEPS: '0' })).toThrow(
      /AGENT_MAX_STEPS/,
    );
  });

  it('rejects a malformed AGENT_TIMEOUT_MS', () => {
    expect(() =>
      loadConfigWith({ DATABASE_URL: 'file:./dev.db', AGENT_TIMEOUT_MS: 'soon' }),
    ).toThrow(/AGENT_TIMEOUT_MS/);
  });

  it('parses successfully with no ANTHROPIC_API_KEY, proving the suite can run without one', () => {
    const { config } = loadConfigWith({
      DATABASE_URL: 'file:./dev.db',
      ANTHROPIC_API_KEY: undefined,
    });

    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('applies defaults for AGENT_MAX_STEPS, AGENT_TIMEOUT_MS and LOG_LEVEL', () => {
    const { config } = loadConfigWith({ DATABASE_URL: 'file:./dev.db' });

    expect(config.AGENT_MAX_STEPS).toBe(12);
    expect(config.AGENT_TIMEOUT_MS).toBe(120_000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('rejects an unrecognised LOG_LEVEL', () => {
    expect(() => loadConfigWith({ DATABASE_URL: 'file:./dev.db', LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });

  it('defines no NEXT_PUBLIC_ setting, so nothing server-only can reach the browser bundle', () => {
    // Next.js inlines any env var prefixed NEXT_PUBLIC_ into the client bundle at build time.
    // config.ts holds ANTHROPIC_API_KEY and other server-only values, so no key here may ever
    // carry that prefix — this guards against that mistake being introduced later, not just today.
    const { config } = loadConfigWith({ DATABASE_URL: 'file:./dev.db' });

    for (const key of Object.keys(config)) {
      expect(key.startsWith('NEXT_PUBLIC_')).toBe(false);
    }
  });

  it('.env.example defines no NEXT_PUBLIC_ setting either', () => {
    const envExample = readFileSync(path.join(__dirname, '../../.env.example'), 'utf-8');
    const assignments = envExample
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && line.includes('='));

    for (const line of assignments) {
      expect(line.startsWith('NEXT_PUBLIC_')).toBe(false);
    }
  });
});

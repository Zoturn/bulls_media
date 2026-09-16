import { getTemplateDbPath, TEST_DB_TEMPLATE_RUN_ID_ENV } from './testDbTemplate';

describe('getTemplateDbPath', () => {
  const original = process.env[TEST_DB_TEMPLATE_RUN_ID_ENV];

  afterEach(() => {
    if (original === undefined) delete process.env[TEST_DB_TEMPLATE_RUN_ID_ENV];
    else process.env[TEST_DB_TEMPLATE_RUN_ID_ENV] = original;
  });

  it('builds a path scoped by the run id when it is set', () => {
    process.env[TEST_DB_TEMPLATE_RUN_ID_ENV] = '12345';
    expect(getTemplateDbPath()).toMatch(/inbound-brief-desk-test-template-12345\.db$/);
  });

  it('throws a clear error when the run id is not set', () => {
    delete process.env[TEST_DB_TEMPLATE_RUN_ID_ENV];
    expect(() => getTemplateDbPath()).toThrow(/TEST_DB_TEMPLATE_RUN_ID/);
  });
});

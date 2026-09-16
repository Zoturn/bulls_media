import { z } from 'zod';
import { failSchema, okSchema, packageNotFoundSchema } from './schemas';

describe('okSchema', () => {
  it('accepts ok: true with data matching the given schema', () => {
    const schema = okSchema(z.object({ total: z.number() }));
    expect(schema.safeParse({ ok: true, data: { total: 5 } }).success).toBe(true);
  });

  it('rejects ok: false', () => {
    const schema = okSchema(z.object({ total: z.number() }));
    expect(schema.safeParse({ ok: false, data: { total: 5 } }).success).toBe(false);
  });

  it('rejects data not matching the given schema', () => {
    const schema = okSchema(z.object({ total: z.number() }));
    expect(schema.safeParse({ ok: true, data: { total: 'five' } }).success).toBe(false);
  });
});

describe('failSchema', () => {
  it('accepts ok: false with the exact reason literal', () => {
    const schema = failSchema('NOT_FOUND');
    expect(schema.safeParse({ ok: false, reason: 'NOT_FOUND' }).success).toBe(true);
  });

  it('rejects a different reason string', () => {
    const schema = failSchema('NOT_FOUND');
    expect(schema.safeParse({ ok: false, reason: 'SOMETHING_ELSE' }).success).toBe(false);
  });

  it('rejects ok: true', () => {
    const schema = failSchema('NOT_FOUND');
    expect(schema.safeParse({ ok: true, reason: 'NOT_FOUND' }).success).toBe(false);
  });
});

describe('packageNotFoundSchema', () => {
  it('accepts the standard not-found shape with a packageId', () => {
    expect(
      packageNotFoundSchema.safeParse({
        ok: false,
        reason: 'PACKAGE_NOT_FOUND',
        packageId: 'rate-display-ros',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing packageId', () => {
    expect(
      packageNotFoundSchema.safeParse({ ok: false, reason: 'PACKAGE_NOT_FOUND' }).success,
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, makeCursor } from './cursor.js';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a valid payload', () => {
    const payload = { createdAt: '2026-01-01T00:00:00.000Z', id: 'abc-123' };
    const cursor = encodeCursor(payload);
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it('returns null for invalid base64', () => {
    expect(decodeCursor('not-valid-base64!!!')).toBeNull();
  });

  it('returns null for base64 that does not decode to valid JSON', () => {
    const notJson = Buffer.from('this is not json').toString('base64url');
    expect(decodeCursor(notJson)).toBeNull();
  });

  it('returns null when createdAt is not a string', () => {
    const bad = Buffer.from(JSON.stringify({ createdAt: 12345, id: 'abc' })).toString(
      'base64url',
    );
    expect(decodeCursor(bad)).toBeNull();
  });

  it('returns null when id is not a string', () => {
    const bad = Buffer.from(
      JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: 42 }),
    ).toString('base64url');
    expect(decodeCursor(bad)).toBeNull();
  });
});

describe('makeCursor', () => {
  it('produces the same createdAt string for a Date and its equivalent ISO string', () => {
    const date = new Date('2026-03-05T12:30:00.000Z');
    const fromDate = decodeCursor(makeCursor({ createdAt: date, id: 'row-1' }));
    const fromString = decodeCursor(
      makeCursor({ createdAt: date.toISOString(), id: 'row-1' }),
    );
    expect(fromDate).toEqual(fromString);
    expect(fromDate?.createdAt).toBe('2026-03-05T12:30:00.000Z');
  });
});

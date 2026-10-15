import { describe, it, expect } from 'vitest';
import { parsePagination, parseLimit } from './pagination.js';

describe('parsePagination', () => {
  it('defaults skip=0, take=20 when nothing is provided', () => {
    expect(parsePagination({})).toEqual({ skip: 0, take: 20 });
  });

  it.each([
    ['negative skip', { skip: '-5' }, 0],
    ['non-numeric skip', { skip: 'abc' }, 0],
    ['empty string skip', { skip: '' }, 0],
    ['valid skip', { skip: '30' }, 30],
  ])('%s -> skip clamped/parsed to expected', (_label, query, expectedSkip) => {
    expect(parsePagination(query).skip).toBe(expectedSkip);
  });

  it.each([
    ['unspecified take falls back to default', {}, 20],
    ['take=0 falls back to default (falsy)', { take: '0' }, 20],
    ['negative take clamps to 1', { take: '-5' }, 1],
    ['non-numeric take falls back to default', { take: 'abc' }, 20],
    ['take over max clamps to max (100)', { take: '9999' }, 100],
    ['valid take is used as-is', { take: '50' }, 50],
  ])('%s', (_label, query, expectedTake) => {
    expect(parsePagination(query).take).toBe(expectedTake);
  });

  it('respects custom defaultTake and maxTake options', () => {
    expect(parsePagination({}, { defaultTake: 5, maxTake: 10 })).toEqual({
      skip: 0,
      take: 5,
    });
    expect(parsePagination({ take: '999' }, { maxTake: 10 }).take).toBe(10);
  });

  it('parses the first value when skip/take is an array (repeated query param)', () => {
    expect(parsePagination({ skip: ['15', '99'] as unknown as string }).skip).toBe(15);
  });
});

describe('parseLimit', () => {
  it('defaults to 20 when unspecified', () => {
    expect(parseLimit({})).toBe(20);
  });

  it.each([
    ['limit=0 falls back to default (falsy)', { limit: '0' }, 20],
    ['negative limit clamps to 1', { limit: '-5' }, 1],
    ['non-numeric limit falls back to default', { limit: 'abc' }, 20],
    ['limit over max clamps to max (100)', { limit: '9999' }, 100],
    ['valid limit is used as-is', { limit: '50' }, 50],
  ])('%s', (_label, query, expected) => {
    expect(parseLimit(query)).toBe(expected);
  });

  it('respects custom default and max options', () => {
    expect(parseLimit({}, { default: 5, max: 10 })).toBe(5);
    expect(parseLimit({ limit: '999' }, { max: 10 })).toBe(10);
  });
});

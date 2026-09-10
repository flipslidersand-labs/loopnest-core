import { describe, it, expect } from 'vitest';
import { clampSkip, clampTake } from './pagination.js';

describe('clampTake', () => {
  it('caps an oversized take at maxTake (#122)', () => {
    expect(clampTake('999999999', 20)).toBe(100);
  });

  it('caps at a custom maxTake', () => {
    expect(clampTake('999999999', 20, 50)).toBe(50);
  });

  it('falls back to defaultTake when missing', () => {
    expect(clampTake(undefined, 20)).toBe(20);
  });

  it('falls back to defaultTake when non-numeric', () => {
    expect(clampTake('not-a-number', 20)).toBe(20);
  });

  it('falls back to defaultTake for zero or negative values', () => {
    expect(clampTake('0', 20)).toBe(20);
    expect(clampTake('-5', 20)).toBe(20);
  });

  it('passes through an in-range value', () => {
    expect(clampTake('30', 20)).toBe(30);
  });
});

describe('clampSkip', () => {
  it('clamps a negative skip to 0', () => {
    expect(clampSkip('-5')).toBe(0);
  });

  it('defaults to 0 when missing or non-numeric', () => {
    expect(clampSkip(undefined)).toBe(0);
    expect(clampSkip('nope')).toBe(0);
  });

  it('passes through a non-negative value', () => {
    expect(clampSkip('40')).toBe(40);
  });
});

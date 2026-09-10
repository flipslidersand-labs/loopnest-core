const MAX_TAKE = 100;

/**
 * Clamp a parsed `take`/`limit` query param to [1, maxTake], falling back to
 * `defaultTake` when the value is missing, non-numeric, or non-positive.
 * Without this, an unbounded value (e.g. `take=999999999`) reaches the DB
 * as a huge LIMIT — see issue #122.
 */
export function clampTake(raw: unknown, defaultTake: number, maxTake: number = MAX_TAKE): number {
  const n = Number.parseInt(raw as string, 10);
  return Math.min(maxTake, Math.max(1, Number.isFinite(n) && n > 0 ? n : defaultTake));
}

/**
 * Clamp a parsed `skip` query param to a non-negative integer, defaulting to
 * 0 when missing or non-numeric.
 */
export function clampSkip(raw: unknown): number {
  const n = Number.parseInt(raw as string, 10);
  return Math.max(0, Number.isFinite(n) ? n : 0);
}

/** Clamp pagination params to safe bounds. */
export const MAX_TAKE = 100;

export function parseTake(raw: unknown, defaultValue = 20): number {
  return Math.min(MAX_TAKE, Math.max(1, Number.parseInt(raw as string) || defaultValue));
}

export function parseSkip(raw: unknown): number {
  return Math.max(0, Number.parseInt(raw as string) || 0);
}

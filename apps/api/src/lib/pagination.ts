const MAX_TAKE = 100;

export function parsePagination(
  query: Record<string, unknown>,
  options: { defaultTake?: number; maxTake?: number } = {}
): { skip: number; take: number } {
  const max = options.maxTake ?? MAX_TAKE;
  const def = options.defaultTake ?? 20;
  const skip = Math.max(0, Number.parseInt(query.skip as string) || 0);
  const take = Math.min(max, Math.max(1, Number.parseInt(query.take as string) || def));
  return { skip, take };
}

export function parseLimit(
  query: Record<string, unknown>,
  options: { default?: number; max?: number } = {}
): number {
  const max = options.max ?? MAX_TAKE;
  const def = options.default ?? 20;
  return Math.min(max, Math.max(1, Number.parseInt(query.limit as string) || def));
}

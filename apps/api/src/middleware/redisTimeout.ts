/**
 * Wraps a Redis-backed promise with a timeout so that a slow or unreachable
 * Redis cannot freeze a request.
 *
 * Why this is needed: the shared ioredis client is configured with
 * `maxRetriesPerRequest: null`, which means commands issued while Redis is
 * unreachable are queued indefinitely instead of rejecting. Middleware that
 * awaits such a command would hang forever, taking the whole API down. Racing
 * against a timeout lets callers degrade gracefully (fail open) on outage.
 */
export const withRedisTimeout = <T>(
  op: Promise<T>,
  timeoutMs = 200
): Promise<T> => {
  return Promise.race([
    op,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('redis-timeout')), timeoutMs)
    ),
  ]);
};

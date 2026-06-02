import { Request, Response, NextFunction } from 'express';
import { redis } from '@loopnest/bizcore-db';
import { withRedisTimeout } from './redisTimeout.js';
import { rateLimitRejectionsTotal } from '../observability/metrics.js';

export interface RateLimitOptions {
  /** Time window in seconds. */
  windowSeconds: number;
  /** Max requests allowed per identity within the window. */
  max: number;
  /** Logical name, used to namespace the Redis keys (e.g. 'workflow'). */
  bucket: string;
  /** Derives the rate-limit identity from the request. Defaults to client IP. */
  identify?: (req: Request) => string;
}

const defaultIdentify = (req: Request): string => {
  const forwarded = req.header('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;
  return ip || 'unknown';
};

/**
 * Sliding-window rate limiter backed by a Redis sorted set.
 *
 * For each identity we keep a ZSET of request timestamps. On every request we
 * drop entries older than the window, count what remains, and reject if the
 * count is at the limit. This is more accurate than a fixed-window counter
 * (no burst-at-the-boundary doubling) and the whole read-modify-write runs in
 * a single MULTI so concurrent requests can't slip past the cap.
 *
 * Emits standard `RateLimit-*` headers and `Retry-After` on rejection.
 */
export const rateLimit = (options: RateLimitOptions) => {
  const { windowSeconds, max, bucket } = options;
  const identify = options.identify ?? defaultIdentify;
  const windowMs = windowSeconds * 1000;

  return (req: Request, res: Response, next: NextFunction): void => {
    const identity = identify(req);
    const key = `ratelimit:${bucket}:${identity}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    withRedisTimeout(
      redis
        .multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, member)
        .zcard(key)
        .pexpire(key, windowMs)
        .exec()
    )
      .then((results) => {
        // results: [zremrangebyscore, zadd, zcard, pexpire]
        const countRaw = results?.[2]?.[1];
        const count = typeof countRaw === 'number' ? countRaw : Number(countRaw);

        const remaining = Math.max(0, max - count);
        res.setHeader('RateLimit-Limit', max);
        res.setHeader('RateLimit-Remaining', remaining);
        res.setHeader('RateLimit-Reset', Math.ceil(windowSeconds));

        if (count > max) {
          // This request put us over the cap — remove our own marker so we
          // don't penalize the window further, then reject.
          redis.zrem(key, member).catch(() => undefined);
          rateLimitRejectionsTotal.inc({ bucket });
          res.setHeader('Retry-After', Math.ceil(windowSeconds));
          res.status(429).json({
            error: {
              code: 'RATE_LIMITED',
              message: `Rate limit exceeded. Max ${max} requests per ${windowSeconds}s.`,
            },
          });
          return;
        }

        next();
      })
      .catch((err) => {
        // Fail open: a Redis hiccup should not take down the API.
        console.error('Rate limit check failed, allowing request:', err);
        next();
      });
  };
};

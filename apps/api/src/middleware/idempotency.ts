import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { redis } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from './errorHandler.js';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const KEY_PREFIX = 'idempotency:';
const TTL_SECONDS = 24 * 60 * 60;
const IN_FLIGHT_TTL_SECONDS = 60;

interface CachedResponse {
  status: 'completed' | 'processing';
  fingerprint: string;
  statusCode?: number;
  body?: unknown;
}

const computeFingerprint = (req: Request): string => {
  const payload = JSON.stringify({
    method: req.method,
    path: req.originalUrl,
    body: req.body ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
};

/**
 * Idempotency middleware. Opt-in via `Idempotency-Key` header.
 *
 * Behavior:
 * - First request: marks key as `processing`, runs handler, caches the response.
 * - Replay (same key + same body): returns the cached response.
 * - Conflict (same key + different body): returns 422.
 * - In-flight collision (same key, prior request still running): returns 409.
 *
 * Only writes the cache on success (2xx). Non-2xx responses do not consume the key,
 * letting clients retry after fixing whatever caused the error.
 */
export const idempotencyMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const rawKey = req.header(IDEMPOTENCY_HEADER);
  if (!rawKey) {
    next();
    return;
  }

  const key = `${KEY_PREFIX}${rawKey}`;
  const fingerprint = computeFingerprint(req);

  redis
    .get(key)
    .then(async (existing) => {
      if (existing) {
        const cached = JSON.parse(existing) as CachedResponse;

        if (cached.fingerprint !== fingerprint) {
          throw new ApiErrorResponse(
            422,
            'IDEMPOTENCY_KEY_CONFLICT',
            'Idempotency key was reused with a different request body'
          );
        }

        if (cached.status === 'processing') {
          throw new ApiErrorResponse(
            409,
            'IDEMPOTENCY_IN_FLIGHT',
            'A previous request with this idempotency key is still in progress'
          );
        }

        res.status(cached.statusCode ?? 200).json(cached.body);
        return;
      }

      const placeholder: CachedResponse = { status: 'processing', fingerprint };
      const acquired = await redis.set(
        key,
        JSON.stringify(placeholder),
        'EX',
        IN_FLIGHT_TTL_SECONDS,
        'NX'
      );

      if (acquired !== 'OK') {
        throw new ApiErrorResponse(
          409,
          'IDEMPOTENCY_IN_FLIGHT',
          'A previous request with this idempotency key is still in progress'
        );
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const completed: CachedResponse = {
            status: 'completed',
            fingerprint,
            statusCode: res.statusCode,
            body,
          };
          redis
            .set(key, JSON.stringify(completed), 'EX', TTL_SECONDS)
            .catch((err) => console.error('Idempotency cache write failed:', err));
        } else {
          redis.del(key).catch(() => undefined);
        }
        return originalJson(body);
      };

      next();
    })
    .catch(next);
};

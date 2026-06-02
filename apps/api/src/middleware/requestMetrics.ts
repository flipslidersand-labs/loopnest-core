import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import {
  httpRequestsTotal,
  httpRequestDurationMs,
  httpRequestsInFlight,
} from '../observability/metrics.js';

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_NUM_RE = /\/\d+(?=\/|$)/g;

/**
 * Collapse high-cardinality path segments (UUIDs, numeric ids) into `:id`
 * so the metrics label space stays bounded regardless of traffic.
 */
export const normalizeRoute = (req: Request): string => {
  const base = `${req.baseUrl}${req.path}` || req.path || '/';
  return base.replace(UUID_RE, ':id').replace(LONG_NUM_RE, '/:id');
};

interface RequestLoggerOptions {
  /** pg pool used to persist a sampled subset to audit.request_logs. */
  pgPool: { query: (text: string, params: unknown[]) => Promise<unknown> };
  /** Fraction of requests to persist (0..1). Metrics are always recorded. */
  sampleRate?: number;
}

/**
 * Per-request observability:
 *  - assigns/propagates a correlation id (X-Correlation-Id)
 *  - records Prometheus metrics (count, duration, in-flight)
 *  - emits a structured JSON access log line
 *  - persists a sampled subset to audit.request_logs (fire-and-forget)
 */
export const requestMetrics = (options: RequestLoggerOptions) => {
  const { pgPool } = options;
  const sampleRate = options.sampleRate ?? 0.1;

  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    const correlationId =
      (req.header('x-correlation-id') as string) || randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    (req as Request & { correlationId?: string }).correlationId = correlationId;

    httpRequestsInFlight.inc();

    res.on('finish', () => {
      httpRequestsInFlight.dec();

      const durationMs =
        Number(process.hrtime.bigint() - start) / 1_000_000;
      const route = normalizeRoute(req);
      const status = String(res.statusCode);
      const labels = { method: req.method, route, status };

      httpRequestsTotal.inc(labels);
      httpRequestDurationMs.observe(durationMs, { method: req.method, route });

      const line = {
        level: res.statusCode >= 500 ? 'error' : 'info',
        msg: 'http_request',
        method: req.method,
        route,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        correlation_id: correlationId,
      };
      console.log(JSON.stringify(line));

      if (Math.random() < sampleRate) {
        const actorId =
          (req.body && typeof req.body === 'object' && req.body.userId) ||
          null;
        pgPool
          .query(
            `INSERT INTO audit.request_logs
               (id, method, path, status_code, duration_ms, correlation_id, actor_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
            [
              randomUUID(),
              req.method,
              route.slice(0, 500),
              res.statusCode,
              Math.round(durationMs),
              correlationId,
              actorId,
            ]
          )
          .catch((err) =>
            console.error('request_logs insert failed:', err?.message ?? err)
          );
      }
    });

    next();
  };
};

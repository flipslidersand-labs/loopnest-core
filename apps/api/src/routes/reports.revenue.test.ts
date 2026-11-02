import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

// auth.ts throws at import time without JWT_SECRET; supply a dummy for the test.
let reportRoutes: typeof import('./reports.js').reportRoutes;
let errorHandler: typeof import('../middleware/errorHandler.js').errorHandler;
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-secret-not-real');
  ({ reportRoutes } = await import('./reports.js'));
  ({ errorHandler } = await import('../middleware/errorHandler.js'));
});

describe('GET /reports/revenue dateFrom/dateTo validation', () => {
  let srv: http.Server | undefined;
  afterEach(async () => {
    srv?.closeAllConnections();
    await new Promise((r) => srv?.close(r));
    srv = undefined;
  });

  async function get(query: string) {
    const getRevenue = vi.fn().mockResolvedValue([]);
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { sub: 'u1', role: 'admin' };
      next();
    });
    app.use('/reports', reportRoutes({ getRevenue } as any));
    app.use(errorHandler as express.ErrorRequestHandler);
    srv = http.createServer(app);
    await new Promise<void>((r) => srv!.listen(0, r));
    const port = (srv.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/reports/revenue${query}`);
    return { status: res.status, body: (await res.json()) as any, getRevenue };
  }

  it.each([
    '?dateFrom=invalid-date',
    '?dateTo=foobar',
    '?dateFrom=2026-01-01&dateTo=2026-13',
    '?dateFrom=2026-01-01&dateFrom=2026-01-02',
  ])('rejects %s with 400 VALIDATION_ERROR and never queries', async (q) => {
    const { status, body, getRevenue } = await get(q);
    expect(status).toBe(400);
    expect(body.error?.code ?? body.code).toBe('VALIDATION_ERROR');
    expect(getRevenue).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '?dateFrom=2026-01-01&dateTo=2026-01-31',
    '?dateFrom=2026-01-01T00:00:00Z&dateTo=2026-01-31T23:59:59.999Z',
  ])('accepts %s', async (q) => {
    const { status, getRevenue } = await get(q);
    expect(status).toBe(200);
    expect(getRevenue).toHaveBeenCalledTimes(1);
  });
});

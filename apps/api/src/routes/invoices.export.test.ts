import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

// auth.ts throws at import time without JWT_SECRET; supply a dummy for the test.
let invoiceRoutes: typeof import('./invoices.js').invoiceRoutes;
beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', 'test-secret-not-real');
  ({ invoiceRoutes } = await import('./invoices.js'));
});

/**
 * Route-level check of GET /export with a fake repository. The fake
 * streamForExport mimics the real one's shape (an async scope that owns a
 * resource -- the DB transaction/connection -- and awaits onRow for each row),
 * so `released` tells us whether the callback failing lets that scope unwind.
 */
function fakeInvoice(i: number) {
  return {
    id: `inv-${i}`,
    invoiceNumber: `N-${i}`,
    customerId: 'c1',
    totalAmount: 1,
    currency: 'JPY',
    status: 'draft',
    createdAt: new Date(0),
    paymentDueDate: null,
    paidAt: null,
    pad: 'x'.repeat(0),
  };
}

describe('GET /invoices/export', () => {
  let srv: http.Server | undefined;
  afterEach(async () => {
    srv?.closeAllConnections();
    await new Promise((r) => srv?.close(r));
    srv = undefined;
  });

  async function start(streamForExport: (f: unknown, onRow: (r: any) => Promise<void>) => Promise<void>) {
    const repos: any = { invoices: { streamForExport }, customers: {}, installments: {} };
    const handlerErrors: unknown[] = [];
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { sub: 'u1', role: 'admin' };
      next();
    });
    app.use('/invoices', invoiceRoutes(repos));
    app.use(((err: unknown, _req: unknown, _res: unknown, _next: unknown) => {
      handlerErrors.push(err);
    }) as express.ErrorRequestHandler);
    srv = http.createServer(app);
    await new Promise<void>((r) => srv!.listen(0, r));
    return { port: (srv.address() as AddressInfo).port, handlerErrors };
  }

  it('streams all rows to a normal client and ends cleanly', async () => {
    const { port } = await start(async (_f, onRow) => {
      for (let i = 0; i < 50; i++) await onRow(fakeInvoice(i));
    });
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get({ port, path: '/invoices/export' }, (r) => {
          let s = '';
          r.on('data', (d) => (s += d));
          r.on('end', () => resolve(s));
          r.on('error', reject);
        })
        .on('error', reject);
    });
    expect(body.trim().split('\n')).toHaveLength(51); // header + 50 rows
  });

  it('client disconnect mid-export: streamForExport scope unwinds (tx/connection released) and the error handler is not hit', async () => {
    let released = false;
    let produced = 0;
    const { port, handlerErrors } = await start(async (_f, onRow) => {
      try {
        for (let i = 0; i < 1_000_000; i++) {
          // fat rows so the socket buffer fills quickly
          await onRow({ ...fakeInvoice(i), customerId: 'c'.repeat(64 * 1024) });
          produced++;
        }
      } finally {
        released = true; // stands in for db.transaction().execute() finishing -> COMMIT/ROLLBACK + release
      }
    });

    await new Promise<void>((resolve) => {
      const req = http.get({ port, path: '/invoices/export' }, (r) => {
        r.pause();
        setTimeout(() => req.destroy(), 300);
      });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
    });

    const deadline = Date.now() + 3000;
    while (!released && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

    expect(released).toBe(true);
    const after = produced;
    await new Promise((r) => setTimeout(r, 200));
    expect(produced).toBe(after); // no runaway loop after the abort
    expect(handlerErrors).toEqual([]); // disconnect is not a server error (headers already sent)
  });

  it('DB error mid-export: the response is aborted (not ended as a truncated-but-valid CSV)', async () => {
    const { port } = await start(async (_f, onRow) => {
      await onRow(fakeInvoice(1));
      throw new Error('db exploded');
    });
    const result = await new Promise<{ complete: boolean; errored: boolean }>((resolve) => {
      const req = http.get({ port, path: '/invoices/export' }, (r) => {
        r.resume();
        r.on('end', () => resolve({ complete: r.complete, errored: false }));
        r.on('error', () => resolve({ complete: r.complete, errored: true }));
        r.on('aborted', () => resolve({ complete: false, errored: true }));
      });
      req.on('error', () => resolve({ complete: false, errored: true }));
    });
    expect(result.errored || !result.complete).toBe(true);
  });
});

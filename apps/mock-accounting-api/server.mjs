#!/usr/bin/env node
/**
 * Mock accounting API — stands in for an external accounting system that
 * invoices are exported to. Zero dependencies (Node built-in http) so it needs
 * no install step.
 *
 * Endpoints:
 *   GET  /health                  -> { status: 'ok' }
 *   POST /api/exports             -> { exportId, invoiceId, duplicate }
 *   GET  /api/exports             -> { count, exports: [...] }
 *   GET  /api/exports/:invoiceId  -> the export, or 404
 *
 * Idempotent: exporting the same invoiceId twice returns the original export
 * with duplicate:true (the outbox delivers at-least-once, so the downstream
 * must dedupe).
 *
 * Failure injection for testing retry/dead-letter:
 *   FAIL_INVOICE_SUBSTR=...  -> reject (500) any invoiceNumber containing this
 *   FAIL_TIMES=N             -> reject the first N total export attempts, then
 *                               succeed (simulates a transient outage)
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_ACCOUNTING_PORT || 3991);
const FAIL_INVOICE_SUBSTR = process.env.FAIL_INVOICE_SUBSTR || '';
let failTimesRemaining = Number(process.env.FAIL_TIMES || 0);

/** invoiceId -> export record */
const exportsByInvoice = new Map();
let totalAttempts = 0;

const send = (res, status, body) => {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { status: 'ok' });
  }

  if (req.method === 'GET' && url.pathname === '/api/exports') {
    return send(res, 200, {
      count: exportsByInvoice.size,
      exports: [...exportsByInvoice.values()],
    });
  }

  const single = url.pathname.match(/^\/api\/exports\/(.+)$/);
  if (req.method === 'GET' && single) {
    const rec = exportsByInvoice.get(decodeURIComponent(single[1]));
    return rec ? send(res, 200, rec) : send(res, 404, { error: 'not_found' });
  }

  if (req.method === 'POST' && url.pathname === '/api/exports') {
    const body = await readBody(req);
    if (!body || !body.invoiceId) {
      return send(res, 400, { error: 'invoiceId required' });
    }

    // Idempotency: replay returns the original record.
    const existing = exportsByInvoice.get(body.invoiceId);
    if (existing) {
      return send(res, 200, { ...existing, duplicate: true });
    }

    totalAttempts += 1;

    // Injected failures (transient outage / poison message simulation).
    const failByName =
      FAIL_INVOICE_SUBSTR && String(body.invoiceNumber || '').includes(FAIL_INVOICE_SUBSTR);
    const failByCount = failTimesRemaining > 0;
    if (failByName || failByCount) {
      if (failByCount) failTimesRemaining -= 1;
      console.log(
        `[mock-accounting] REJECT export for ${body.invoiceNumber} ` +
          `(reason=${failByName ? 'name' : 'count'}, attempt=${totalAttempts})`
      );
      return send(res, 500, { error: 'accounting_system_unavailable' });
    }

    const record = {
      exportId: randomUUID(),
      invoiceId: body.invoiceId,
      invoiceNumber: body.invoiceNumber ?? null,
      customerId: body.customerId ?? null,
      totalAmount: body.totalAmount ?? null,
      receivedAt: new Date().toISOString(),
    };
    exportsByInvoice.set(body.invoiceId, record);
    console.log(`[mock-accounting] ACCEPT export ${record.invoiceNumber} -> ${record.exportId}`);
    return send(res, 201, { ...record, duplicate: false });
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`🧾 Mock accounting API listening on http://localhost:${PORT}`);
  if (FAIL_INVOICE_SUBSTR) console.log(`   failing invoices containing "${FAIL_INVOICE_SUBSTR}"`);
  if (failTimesRemaining) console.log(`   failing first ${failTimesRemaining} attempts`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

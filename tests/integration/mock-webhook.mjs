#!/usr/bin/env node
/**
 * Mock webhook receiver — captures incoming webhook deliveries for test assertions.
 * Zero dependencies (Node built-in http only).
 *
 * Endpoints:
 *   POST /           -> 200 { ok: true }        (receive a delivery)
 *   GET  /received   -> { count, items: [...] } (list captured deliveries)
 *   DELETE /received -> 204                     (clear all)
 *   GET  /health     -> { status: 'ok' }
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_WEBHOOK_PORT || 3993);

/** @type {Array<{ headers: Record<string,string>, body: any, receivedAt: string }>} */
const received = [];

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && req.url === '/received') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: received.length, items: received }));
    return;
  }

  if (req.method === 'DELETE' && req.url === '/received') {
    received.length = 0;
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { body = raw; }
      received.push({
        headers:    Object.fromEntries(Object.entries(req.headers)),
        body,
        receivedAt: new Date().toISOString(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  process.stdout.write(`mock-webhook listening on :${PORT}\n`);
});

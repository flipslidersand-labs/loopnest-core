import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Response } from 'express';
import { writeWithBackpressure, ClientDisconnectedError } from './writeWithBackpressure.js';

const EVENTS = ['drain', 'close', 'error'] as const;

function listenerCounts(res: EventEmitter) {
  return Object.fromEntries(EVENTS.map((e) => [e, res.listenerCount(e)]));
}

/** Minimal stand-in for http.ServerResponse: write() result is scripted. */
function fakeRes(writeResult: boolean) {
  const res = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    writableEnded: boolean;
    write: (chunk: string) => boolean;
  };
  res.destroyed = false;
  res.writableEnded = false;
  res.write = () => writeResult;
  return res;
}
const asRes = (r: unknown) => r as Response;

describe('writeWithBackpressure (unit, fake response)', () => {
  it('resolves immediately and attaches nothing when write() returns true', async () => {
    const res = fakeRes(true);
    await writeWithBackpressure(asRes(res), 'x');
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('waits for drain when write() returns false, then removes all listeners', async () => {
    const res = fakeRes(false);
    let settled = false;
    const p = writeWithBackpressure(asRes(res), 'x').then(() => (settled = true));
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);
    expect(listenerCounts(res)).toEqual({ drain: 1, close: 1, error: 1 });
    res.emit('drain');
    await p;
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('rejects on close while waiting for drain and removes all listeners', async () => {
    const res = fakeRes(false);
    const p = writeWithBackpressure(asRes(res), 'x');
    res.emit('close');
    await expect(p).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('rejects on error while waiting for drain, keeps the cause, and removes all listeners', async () => {
    const res = fakeRes(false);
    const p = writeWithBackpressure(asRes(res), 'x');
    const cause = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    res.emit('error', cause);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ClientDisconnectedError);
    expect(err.originalError).toBe(cause);
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('rejects immediately without writing when the response is already destroyed', async () => {
    const res = fakeRes(false);
    res.destroyed = true;
    let wrote = false;
    res.write = () => ((wrote = true), false);
    await expect(writeWithBackpressure(asRes(res), 'x')).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(wrote).toBe(false);
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('rejects immediately when the response has already ended', async () => {
    const res = fakeRes(true);
    res.writableEnded = true;
    await expect(writeWithBackpressure(asRes(res), 'x')).rejects.toBeInstanceOf(ClientDisconnectedError);
  });

  it('rejects when write() itself destroys the response (no wait for a drain that never comes)', async () => {
    const res = fakeRes(false);
    res.write = () => ((res.destroyed = true), false);
    await expect(writeWithBackpressure(asRes(res), 'x')).rejects.toBeInstanceOf(ClientDisconnectedError);
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('does not accumulate listeners or trigger MaxListeners warnings over many backpressured rows', async () => {
    const res = fakeRes(false);
    const warnings: Error[] = [];
    const onWarning = (w: Error) => warnings.push(w);
    process.on('warning', onWarning);
    try {
      for (let i = 0; i < 15000; i++) {
        const p = writeWithBackpressure(asRes(res), 'row\n');
        res.emit('drain');
        await p;
      }
      await new Promise((r) => setImmediate(r));
    } finally {
      process.off('warning', onWarning);
    }
    expect(listenerCounts(res)).toEqual({ drain: 0, close: 0, error: 0 });
    expect(warnings.filter((w) => w.name === 'MaxListenersExceededWarning')).toEqual([]);
  });
});

describe('writeWithBackpressure (real http server)', () => {
  let srv: http.Server | undefined;
  afterEach(async () => {
    srv?.closeAllConnections();
    await new Promise((r) => srv?.close(r));
    srv = undefined;
  });

  const CHUNK = 'x'.repeat(64 * 1024);

  it('slow client: enters the write()===false branch, waits for drain, and delivers every byte', async () => {
    const TOTAL = 200;
    let sawBackpressure = false;
    let writeError: unknown;
    srv = http.createServer(async (_req, res) => {
      const origWrite = res.write.bind(res);
      res.write = ((chunk: string) => {
        const ok = origWrite(chunk);
        if (!ok) sawBackpressure = true;
        return ok;
      }) as typeof res.write;
      try {
        for (let i = 0; i < TOTAL; i++) await writeWithBackpressure(res as unknown as Response, CHUNK);
        res.end();
      } catch (e) {
        writeError = e;
        res.destroy();
      }
    });
    await new Promise<void>((r) => srv!.listen(0, r));
    const port = (srv.address() as AddressInfo).port;

    const received = await new Promise<number>((resolve, reject) => {
      http
        .get({ port }, (r) => {
          let n = 0;
          r.pause();
          // Slow consumer: do not read for a while so the server hits the high-water mark.
          setTimeout(() => r.resume(), 200);
          r.on('data', (d) => (n += d.length));
          r.on('end', () => resolve(n));
          r.on('error', reject);
        })
        .on('error', reject);
    });

    expect(writeError).toBeUndefined();
    expect(sawBackpressure).toBe(true);
    expect(received).toBe(TOTAL * CHUNK.length);
  });

  it('client disconnects mid-stream: the pending write rejects, the loop stops, no listeners remain', async () => {
    let rowsWritten = 0;
    let outcome: unknown = 'pending';
    let counts: Record<string, number> | undefined;
    let baseline: Record<string, number> | undefined;
    srv = http.createServer((_req, res) => {
      baseline = listenerCounts(res);
      const loop = (async () => {
        for (let i = 0; i < 1_000_000; i++) {
          await writeWithBackpressure(res as unknown as Response, CHUNK);
          rowsWritten++;
        }
      })();
      loop.then(
        () => (outcome = 'resolved'),
        (e) => {
          outcome = e;
          counts = listenerCounts(res);
        }
      );
    });
    await new Promise<void>((r) => srv!.listen(0, r));
    const port = (srv.address() as AddressInfo).port;

    await new Promise<void>((resolve) => {
      const req = http.get({ port }, (r) => {
        r.pause(); // never read -> server blocks on drain
        setTimeout(() => req.destroy(), 300);
      });
      req.on('error', () => resolve());
      req.on('close', () => resolve());
    });

    // The loop must settle (reject) shortly after the abort instead of staying pending.
    const deadline = Date.now() + 3000;
    while (outcome === 'pending' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));

    expect(outcome).toBeInstanceOf(ClientDisconnectedError);
    // Loop stopped: rowsWritten does not keep growing after settlement.
    const after = rowsWritten;
    await new Promise((r) => setTimeout(r, 200));
    expect(rowsWritten).toBe(after);
    expect(counts).toEqual(baseline);
    expect(counts).toEqual({ drain: 0, close: 0, error: 0 });
  });

  it('writing to an already-closed response rejects instead of hanging', async () => {
    let outcome: unknown = 'pending';
    srv = http.createServer((_req, res) => {
      res.on('close', () => {
        // 'close' already fired: a drain can never arrive from here on.
        writeWithBackpressure(res as unknown as Response, CHUNK).then(
          () => (outcome = 'resolved'),
          (e) => (outcome = e)
        );
      });
    });
    await new Promise<void>((r) => srv!.listen(0, r));
    const port = (srv.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      const req = http.get({ port });
      req.on('error', () => resolve());
      setTimeout(() => req.destroy(), 100);
    });
    const deadline = Date.now() + 2000;
    while (outcome === 'pending' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(outcome).toBeInstanceOf(ClientDisconnectedError);
  });
});

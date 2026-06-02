#!/usr/bin/env node
/**
 * Dependency-free load harness for the LoopNest Core API.
 *
 * Spins up CONCURRENCY virtual users that loop until DURATION_S elapses, each
 * picking a weighted scenario and recording per-call latency. Prints throughput,
 * latency percentiles, and a status-code breakdown, then diffs the server's
 * /metrics counters across the run.
 *
 * Each iteration uses a unique X-Forwarded-For so the per-IP rate limiter does
 * not throttle the test (it simulates a pool of distinct clients). The limiter
 * is verified separately by tests/integration/rate_limit.sh.
 *
 * Usage:
 *   node tests/load/load.mjs
 *   DURATION_S=30 CONCURRENCY=50 node tests/load/load.mjs
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const ROOT = BASE.replace(/\/api$/, '');
const DURATION_S = Number(process.env.DURATION_S || 15);
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);

let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  const n = ipCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};

const samples = []; // { scenario, label, ms, status, ok }
const errors = [];

async function call(method, url, { ip, body, headers } = {}) {
  const start = performance.now();
  let status = 0;
  let ok = false;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    ok = res.ok;
    const json = await res.json().catch(() => null);
    return { status, ok, json };
  } catch (err) {
    errors.push(err?.message || String(err));
    return { status: 0, ok: false, json: null };
  } finally {
    samples.push({ ms: performance.now() - start, status, ok });
  }
}

// --- Scenarios ----------------------------------------------------------------

async function readCustomers(ip) {
  await call('GET', `${BASE}/customers?take=10`, { ip });
}

async function readProducts(ip) {
  await call('GET', `${BASE}/products?take=10`, { ip });
}

async function fullWorkflow(ip) {
  const cust = await call('POST', `${BASE}/customers`, {
    ip,
    body: { name: `LoadCorp ${Math.random().toString(36).slice(2, 8)}`, phone: '000', address: 'x' },
  });
  const customerId = cust.json?.data?.id;
  if (!customerId) return;

  const qn = `QT-LOAD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const quote = await call('POST', `${BASE}/quotes`, {
    ip,
    body: {
      quoteNumber: qn,
      customerId,
      subtotalAmount: 100000,
      taxAmount: 10000,
      totalAmount: 110000,
      createdBy: 'loadtest',
    },
  });
  const quoteId = quote.json?.data?.id;
  if (!quoteId) return;

  await call('POST', `${BASE}/workflow/quotes/${quoteId}/submit`, { ip, body: { userId: 'loadtest' } });
  await call('POST', `${BASE}/workflow/quotes/${quoteId}/approve`, {
    ip,
    body: { userId: 'loadtest', notes: 'ok' },
  });
  await call('POST', `${BASE}/workflow/quotes/${quoteId}/invoice`, { ip, body: { userId: 'loadtest' } });
}

// weight = relative frequency
const SCENARIOS = [
  { name: 'read_customers', weight: 45, run: readCustomers },
  { name: 'read_products', weight: 25, run: readProducts },
  { name: 'full_workflow', weight: 30, run: fullWorkflow },
];
const TOTAL_WEIGHT = SCENARIOS.reduce((s, x) => s + x.weight, 0);

function pickScenario() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const s of SCENARIOS) {
    if (r < s.weight) return s;
    r -= s.weight;
  }
  return SCENARIOS[0];
}

// --- Metrics diff -------------------------------------------------------------

async function scrapeCounters() {
  try {
    const res = await fetch(`${ROOT}/metrics`);
    const text = await res.text();
    const total = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^http_requests_total\{.*status="(\d+)".*\}\s+(\d+)/);
      if (m) total[m[1]] = (total[m[1]] || 0) + Number(m[2]);
    }
    return total;
  } catch {
    return {};
  }
}

// --- Runner -------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function worker(deadline) {
  while (performance.now() < deadline) {
    const ip = nextIp();
    const scenario = pickScenario();
    await scenario.run(ip);
  }
}

async function main() {
  console.log(`Load test: ${CONCURRENCY} workers, ${DURATION_S}s, target ${BASE}`);

  // Verify server up.
  const health = await fetch(`${ROOT}/health`).then((r) => r.ok).catch(() => false);
  if (!health) {
    console.error('Server not reachable at', ROOT);
    process.exit(1);
  }

  const before = await scrapeCounters();
  const startWall = performance.now();
  const deadline = startWall + DURATION_S * 1000;

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(deadline)));

  const elapsedS = (performance.now() - startWall) / 1000;
  const after = await scrapeCounters();

  // --- Report ---
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const byStatus = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  const okCount = samples.filter((s) => s.ok).length;

  console.log('\n=== Results ===');
  console.log(`Duration:        ${elapsedS.toFixed(2)}s`);
  console.log(`Total requests:  ${samples.length}`);
  console.log(`Throughput:      ${(samples.length / elapsedS).toFixed(1)} req/s`);
  console.log(`Success (2xx):   ${okCount} (${((okCount / samples.length) * 100).toFixed(1)}%)`);
  console.log(`Network errors:  ${errors.length}`);
  console.log('\nLatency (ms):');
  console.log(`  min   ${latencies[0]?.toFixed(1)}`);
  console.log(`  p50   ${percentile(latencies, 50).toFixed(1)}`);
  console.log(`  p90   ${percentile(latencies, 90).toFixed(1)}`);
  console.log(`  p95   ${percentile(latencies, 95).toFixed(1)}`);
  console.log(`  p99   ${percentile(latencies, 99).toFixed(1)}`);
  console.log(`  max   ${latencies[latencies.length - 1]?.toFixed(1)}`);
  console.log('\nStatus codes:');
  for (const [code, n] of Object.entries(byStatus).sort()) {
    console.log(`  ${code}: ${n}`);
  }
  console.log('\nServer /metrics http_requests_total delta:');
  const codes = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const c of [...codes].sort()) {
    console.log(`  ${c}: +${(after[c] || 0) - (before[c] || 0)}`);
  }

  // Fail the run if too many requests errored (excluding rate-limit 429s,
  // which should be ~0 here given per-iteration IPs).
  const non2xx = samples.length - okCount;
  const serverErrors = (byStatus['500'] || 0) + (byStatus['503'] || 0);
  if (errors.length > 0 || serverErrors > 0) {
    console.log(`\n❌ Load test FAILED (network errors=${errors.length}, 5xx=${serverErrors})`);
    process.exit(1);
  }
  console.log(`\n✅ Load test passed (non-2xx=${non2xx}, no 5xx, no network errors)`);
}

main();

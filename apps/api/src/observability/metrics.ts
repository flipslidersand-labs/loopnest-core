/**
 * Tiny dependency-free metrics registry that renders Prometheus text format.
 *
 * We deliberately avoid pulling in prom-client: the surface we need is a few
 * counters, an in-flight gauge, and one latency histogram. Keeping it in-process
 * and allocation-light means the metrics path adds negligible request overhead.
 */

type Labels = Record<string, string>;

const labelKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');

const renderLabels = (labels: Labels): string => {
  const entries = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k].replace(/"/g, '\\"')}"`);
  return entries.length ? `{${entries.join(',')}}` : '';
};

class Counter {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string
  ) {}

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    const existing = this.values.get(key);
    if (existing) existing.value += amount;
    else this.values.set(key, { labels, value: amount });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string
  ) {}

  inc(amount = 1): void {
    this.value += amount;
  }
  dec(amount = 1): void {
    this.value -= amount;
  }
  set(v: number): void {
    this.value = v;
  }

  render(): string {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
      `${this.name} ${this.value}`,
    ].join('\n');
  }
}

class Histogram {
  private buckets: number[];
  private counts: Map<string, number[]> = new Map();
  private sums: Map<string, number> = new Map();
  private totals: Map<string, number> = new Map();
  private labelSets: Map<string, Labels> = new Map();

  constructor(
    readonly name: string,
    readonly help: string,
    buckets: number[]
  ) {
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    if (!this.counts.has(key)) {
      this.counts.set(key, new Array(this.buckets.length).fill(0));
      this.sums.set(key, 0);
      this.totals.set(key, 0);
      this.labelSets.set(key, labels);
    }
    const bucketCounts = this.counts.get(key)!;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) bucketCounts[i] += 1;
    }
    this.sums.set(key, this.sums.get(key)! + value);
    this.totals.set(key, this.totals.get(key)! + 1);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const key of this.counts.keys()) {
      const labels = this.labelSets.get(key)!;
      const bucketCounts = this.counts.get(key)!;
      for (let i = 0; i < this.buckets.length; i++) {
        const le = { ...labels, le: String(this.buckets[i]) };
        lines.push(`${this.name}_bucket${renderLabels(le)} ${bucketCounts[i]}`);
      }
      const inf = { ...labels, le: '+Inf' };
      lines.push(`${this.name}_bucket${renderLabels(inf)} ${this.totals.get(key)}`);
      lines.push(`${this.name}_sum${renderLabels(labels)} ${this.sums.get(key)}`);
      lines.push(`${this.name}_count${renderLabels(labels)} ${this.totals.get(key)}`);
    }
    return lines.join('\n');
  }
}

// ---- Registry ----------------------------------------------------------------

export const httpRequestsTotal = new Counter(
  'http_requests_total',
  'Total HTTP requests by method, route and status code'
);

export const httpRequestDurationMs = new Histogram(
  'http_request_duration_ms',
  'HTTP request latency in milliseconds',
  [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
);

export const httpRequestsInFlight = new Gauge(
  'http_requests_in_flight',
  'Number of HTTP requests currently being served'
);

export const rateLimitRejectionsTotal = new Counter(
  'rate_limit_rejections_total',
  'Requests rejected by the rate limiter, by bucket'
);

const processStart = Date.now();

export const renderMetrics = (): string => {
  const uptime = [
    '# HELP process_uptime_seconds Seconds since the API process started',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${Math.floor((Date.now() - processStart) / 1000)}`,
  ].join('\n');

  return (
    [
      httpRequestsTotal.render(),
      httpRequestDurationMs.render(),
      httpRequestsInFlight.render(),
      rateLimitRejectionsTotal.render(),
      uptime,
    ].join('\n\n') + '\n'
  );
};
